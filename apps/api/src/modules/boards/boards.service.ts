import { Injectable } from '@nestjs/common';
import {
  SWIMLANE_BY,
  type BoardDto,
  type BoardTeamLaneDto,
  type IssueDto,
  type SwimlaneBy,
} from '@tirapro/types';
import {
  JqlParseError,
  parseJql,
  type SetBoardColumnsInput,
  type UpdateBoardInput,
} from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BoardStatusHasIssuesException,
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { assertNotArchived } from '../../common/project-writable';
import type { PageResult } from '../../common/dto/page-result';
import { IssuesService } from '../issues/issues.service';
import { SearchService } from '../search/search.service';
import { WorkflowResolver } from '../workflow-admin/workflow-resolver.service';

const boardInclude = {
  columns: { include: { statuses: true }, orderBy: { order: 'asc' } },
} satisfies Prisma.BoardInclude;

/** Board kèm trạng thái lưu trữ + workflow của dự án — dùng cho thao tác ghi. */
const boardWriteInclude = {
  ...boardInclude,
  project: { select: { archivedAt: true, defaultWorkflowId: true } },
} satisfies Prisma.BoardInclude;

const CHANGED_BY_OTHER =
  'Bảng vừa được người khác thay đổi — hãy tải lại trang rồi chỉnh lại các cột';

type BoardRow = Prisma.BoardGetPayload<{ include: typeof boardInclude }>;

@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
    private readonly search: SearchService,
    // Quy trình theo loại việc; không phụ thuộc gì nên spec dựng bằng 3 đối số vẫn chạy.
    private readonly workflows: WorkflowResolver = new WorkflowResolver(),
  ) {}

  async listForProject(organizationId: string, projectId: string): Promise<BoardDto[]> {
    // Thiếu projectId ⇒ Prisma bỏ qua điều kiện, liệt kê bảng của MỌI dự án (kể cả riêng tư): bắt buộc phải có.
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    const boards = await this.prisma.board.findMany({
      where: { projectId, deletedAt: null, project: { organizationId, deletedAt: null } },
      include: boardInclude,
      orderBy: { createdAt: 'asc' },
    });
    return boards.map((b) => this.toDto(b));
  }

  async get(organizationId: string, boardId: string): Promise<BoardDto> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null, project: { organizationId, deletedAt: null } },
      include: boardInclude,
    });
    if (!board) throw new NotFoundAppException('Bảng việc');
    return this.toDto(board);
  }

  /** Board dùng cho thao tác GHI: dự án đã lưu trữ thì từ chối ngay. */
  private async require(organizationId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null, project: { organizationId, deletedAt: null } },
      include: boardWriteInclude,
    });
    if (!board) throw new NotFoundAppException('Bảng việc');
    assertNotArchived(board.project.archivedAt);
    return board;
  }

  /** Sửa tên / loại (Scrum ↔ Kanban) / bộ lọc JQL / cách chia swimlane. `filterJql` rỗng = bỏ bộ lọc. */
  async update(
    organizationId: string,
    boardId: string,
    input: UpdateBoardInput,
  ): Promise<BoardDto> {
    const board = await this.require(organizationId, boardId);
    const data: Prisma.BoardUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.type !== undefined) data.type = input.type;
    if (input.filterJql !== undefined) {
      const jql = input.filterJql?.trim() ?? '';
      if (jql) {
        try {
          parseJql(jql);
        } catch (e) {
          if (e instanceof JqlParseError)
            throw new BusinessRuleException(`Bộ lọc JQL không hợp lệ: ${e.message}`);
          throw e;
        }
      }
      data.filterJql = jql || null;
    }
    if (input.swimlaneBy !== undefined) {
      // Giữ các khoá khác trong swimlaneConfig (nếu sau này có thêm), chỉ đổi `by`.
      const prev =
        board.swimlaneConfig &&
        typeof board.swimlaneConfig === 'object' &&
        !Array.isArray(board.swimlaneConfig)
          ? (board.swimlaneConfig as Record<string, unknown>)
          : {};
      data.swimlaneConfig = { ...prev, by: input.swimlaneBy };
    }
    await this.prisma.board.update({ where: { id: boardId }, data, select: { id: true } });
    return this.get(organizationId, boardId);
  }

  /**
   * Thay TOÀN BỘ cột của board. Mọi trạng thái của workflow dự án phải nằm đúng một cột — nếu không, thẻ ở
   * trạng thái đó sẽ biến mất khỏi board. Ghi trong một transaction: xoá cột bị bỏ, cập nhật cột cũ theo `id`,
   * tạo cột mới, ghi lại liên kết cột-trạng thái; `order` theo thứ tự mảng.
   */
  async setColumns(
    organizationId: string,
    boardId: string,
    input: SetBoardColumnsInput,
  ): Promise<BoardDto> {
    const board = await this.require(organizationId, boardId);
    const { columns } = input;

    // Mỗi loại việc có thể dùng quy trình khác nhau, nên cột phải phủ trạng thái của MỌI quy trình đang dùng trong dự án
    // (bắt buộc, mỗi trạng thái đúng một cột). Quy trình mặc định cũ của dự án vẫn được phép nằm trong cột (không bắt buộc)
    // để cột cũ còn giữ thẻ cho tới khi việc được chuyển sang quy trình mới.
    const inUse = new Set((await this.workflows.forProject(this.prisma, board.projectId)).values());
    const legacy = board.project.defaultWorkflowId;
    const workflowIds = [...new Set([...inUse, ...(legacy ? [legacy] : [])])];
    const statuses = workflowIds.length
      ? await this.prisma.status.findMany({
          where: { workflowId: { in: workflowIds } },
          select: { id: true, name: true, workflowId: true },
        })
      : [];
    const nameOf = new Map(statuses.map((s) => [s.id, s.name]));
    const required = statuses.filter((s) => inUse.has(s.workflowId));

    const unknown = new Set<string>();
    const seen = new Map<string, number>();
    for (const c of columns) {
      for (const sid of c.statusIds) {
        if (!nameOf.has(sid)) unknown.add(sid);
        seen.set(sid, (seen.get(sid) ?? 0) + 1);
      }
    }
    if (unknown.size) {
      throw new BusinessRuleException(
        'Có trạng thái không thuộc quy trình của dự án này — hãy tải lại trang rồi chọn lại',
      );
    }
    const missing = required.filter((s) => !seen.has(s.id)).map((s) => s.name);
    const duplicated = statuses.filter((s) => (seen.get(s.id) ?? 0) > 1).map((s) => s.name);
    if (missing.length || duplicated.length) {
      const parts: string[] = [];
      if (missing.length) parts.push(`chưa nằm trong cột nào: ${missing.join(', ')}`);
      if (duplicated.length) parts.push(`nằm ở nhiều hơn một cột: ${duplicated.join(', ')}`);
      throw new BusinessRuleException(`Mỗi trạng thái phải nằm đúng một cột — ${parts.join('; ')}`);
    }

    // Bỏ một trạng thái khỏi bảng (không còn cột nào chứa) khi dự án còn việc ở đó → việc biến mất khỏi bảng: từ chối.
    const before = await this.prisma.boardColumnStatus.findMany({
      where: { column: { boardId } },
      select: { statusId: true, status: { select: { name: true } } },
    });
    const dropped = before.filter((l) => !seen.has(l.statusId));
    if (dropped.length > 0) {
      // allow-deleted: việc ở thùng rác vẫn giữ trạng thái đó (khôi phục cần chỗ trên bảng) nên PHẢI được đếm
      const counts = await this.prisma.issue.groupBy({
        by: ['statusId'],
        where: { projectId: board.projectId, statusId: { in: dropped.map((d) => d.statusId) } },
        _count: { _all: true },
      });
      if (counts.length > 0) {
        const nameById = new Map(dropped.map((d) => [d.statusId, d.status.name]));
        throw new BoardStatusHasIssuesException(
          counts.map((c) => ({
            statusId: c.statusId,
            name: nameById.get(c.statusId) ?? c.statusId,
            count: c._count._all,
          })),
        );
      }
    }

    const names = columns.map((c) => c.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      throw new BusinessRuleException('Tên cột bị trùng nhau — hãy đặt mỗi cột một tên khác nhau');
    }

    const existingIds = new Set(board.columns.map((c) => c.id));
    const keepIds: string[] = [];
    for (const c of columns) {
      if (!c.id) continue;
      if (!existingIds.has(c.id) || keepIds.includes(c.id)) throw new NotFoundAppException('Cột');
      keepIds.push(c.id);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Khoá dòng Board làm câu đầu tiên: các setColumns đồng thời xếp hàng, người sau thấy kết quả của người trước.
        // Chỉ khoá board chưa xoá mềm: bị xoá giữa lúc đọc và lúc khoá thì 404 rõ ràng thay vì ghi vào board đã xoá.
        const locked = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM "Board" WHERE "id" = ${boardId} AND "deletedAt" IS NULL FOR UPDATE`;
        if (locked.length === 0) throw new NotFoundAppException('Bảng việc');
        const live = new Set(
          (await tx.boardColumn.findMany({ where: { boardId }, select: { id: true } })).map(
            (c) => c.id,
          ),
        );
        for (const id of keepIds) {
          if (!live.has(id)) throw new BusinessRuleException(CHANGED_BY_OTHER);
        }
        await tx.boardColumn.deleteMany({ where: { boardId, id: { notIn: keepIds } } });
        // Đổi tên tạm trước để hoán đổi/dịch tên giữa các cột không vấp unique [boardId, name] giữa chừng.
        for (const id of keepIds)
          await tx.boardColumn.update({ where: { id }, data: { name: `~${id}` } });
        const links: Prisma.BoardColumnStatusCreateManyInput[] = [];
        for (let order = 0; order < columns.length; order++) {
          const c = columns[order]!;
          const data = { name: c.name.trim(), order, wipLimit: c.wipLimit ?? null };
          let columnId = c.id;
          if (columnId) await tx.boardColumn.update({ where: { id: columnId }, data });
          else
            columnId = (
              await tx.boardColumn.create({ data: { boardId, ...data }, select: { id: true } })
            ).id;
          for (const statusId of c.statusIds) links.push({ columnId, statusId });
        }
        await tx.boardColumnStatus.deleteMany({ where: { columnId: { in: keepIds } } });
        await tx.boardColumnStatus.createMany({ data: links });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          throw new BusinessRuleException(
            'Tên cột bị trùng nhau (hoặc vừa có người tạo cột cùng tên) — hãy đặt mỗi cột một tên khác nhau rồi lưu lại',
          );
        }
        if (e.code === 'P2025') throw new BusinessRuleException(CHANGED_BY_OTHER);
      }
      throw e;
    }
    return this.get(organizationId, boardId);
  }

  /**
   * Issue của board: có `filterJql` thì lọc theo JQL (trong phạm vi dự án của board), không thì cả dự án
   * như `/issues?projectId`. Dùng chung đường truy vấn của Search nên `currentUser()` + full-text hoạt động.
   */
  async listIssues(
    organizationId: string,
    userId: string,
    boardId: string,
    cursor: string | undefined,
    limit: number,
    teamIds?: string[],
  ): Promise<PageResult<IssueDto>> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null, project: { organizationId, deletedAt: null } },
      select: { projectId: true, filterJql: true },
    });
    if (!board) throw new NotFoundAppException('Bảng việc');
    // Bộ lọc nhanh theo team riêng của dự án: người phụ trách ∈ hợp thành viên các team đã chọn (cộng với bộ lọc JQL của board nếu có).
    const assigneeIds = teamIds?.length
      ? await this.teamMemberIds(board.projectId, teamIds)
      : undefined;
    if (!board.filterJql?.trim()) {
      return this.issues.list(
        organizationId,
        { projectId: board.projectId, ...(assigneeIds ? { assigneeIds } : {}) },
        cursor,
        limit,
        userId,
      );
    }
    return this.search.search(organizationId, userId, {
      mode: 'jql',
      jql: board.filterJql,
      projectId: board.projectId,
      cursor,
      limit,
      excludeUntriaged: true, // cùng quy tắc với nhánh `list()` ở trên: việc chưa duyệt không lên board
      orderByRank: true, // cùng thứ tự với board không có bộ lọc (IssuesService.list: rank tăng dần) để phân trang khớp thứ tự hiển thị
      ...(assigneeIds ? { assigneeIds } : {}),
    });
  }

  /** Hợp thành viên các team riêng `teamIds` của dự án; id không thuộc dự án → 422 (không lọc im lặng sai). */
  private async teamMemberIds(projectId: string, teamIds: string[]): Promise<string[]> {
    const unique = [...new Set(teamIds)];
    const teams = await this.prisma.projectSubTeam.findMany({
      where: { id: { in: unique }, projectId },
      select: { members: { select: { userId: true } } },
    });
    if (teams.length !== unique.length)
      throw new BusinessRuleException('Có team không thuộc dự án của bảng này');
    return [...new Set(teams.flatMap((t) => t.members.map((m) => m.userId)))];
  }

  /**
   * Dữ liệu swimlane "theo team": mỗi team riêng của dự án một làn (xếp theo tên) kèm id thành viên. Giao diện đặt MỖI việc vào đúng một làn
   * (làn của team đầu tiên theo tên mà người phụ trách thuộc về, ưu tiên team đang lọc) để kéo-thả thẻ không bị trùng id; việc chưa gán /
   * người không thuộc team nào đi vào làn "Chưa thuộc team nào" (giao diện dựng từ `memberIds`).
   */
  async teamLanes(organizationId: string, boardId: string): Promise<BoardTeamLaneDto[]> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null, project: { organizationId, deletedAt: null } },
      select: { projectId: true },
    });
    if (!board) throw new NotFoundAppException('Bảng việc');
    const teams = await this.prisma.projectSubTeam.findMany({
      where: { projectId: board.projectId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, color: true, members: { select: { userId: true } } },
    });
    return teams.map((t) => ({
      teamId: t.id,
      name: t.name,
      color: t.color,
      memberIds: t.members.map((m) => m.userId),
    }));
  }

  private toDto(b: BoardRow): BoardDto {
    const cfg = b.swimlaneConfig as { by?: unknown } | null;
    const by = (SWIMLANE_BY as readonly unknown[]).includes(cfg?.by)
      ? (cfg!.by as SwimlaneBy)
      : 'none';
    return {
      id: b.id,
      projectId: b.projectId,
      name: b.name,
      type: b.type,
      filterJql: b.filterJql,
      swimlaneBy: by,
      columns: b.columns.map((c) => ({
        id: c.id,
        boardId: c.boardId,
        name: c.name,
        order: c.order,
        wipLimit: c.wipLimit,
        statusIds: c.statuses.map((s) => s.statusId),
      })),
    };
  }
}
