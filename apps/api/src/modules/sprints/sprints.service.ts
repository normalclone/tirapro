import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, type SprintDto } from '@tirapro/types';
import type { CompleteSprintInput, CreateSprintInput, UpdateSprintInput } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { iso } from '../../common/mappers/date';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertNotArchived } from '../../common/project-writable';

/** Số lần thử lại khi hai request tạo sprint tính trùng sequence. */
const SEQUENCE_RETRIES = 3;

@Injectable()
export class SprintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async listForProject(workspaceId: string, projectId: string): Promise<SprintDto[]> {
    const sprints = await this.prisma.sprint.findMany({
      where: { projectId, deletedAt: null, project: { workspaceId } },
      orderBy: [{ state: 'asc' }, { sequence: 'desc' }],
    });
    if (sprints.length === 0) return [];
    // Đếm issue + tổng điểm bằng một câu GROUP BY (không kéo từng issue về); issue đã xoá mềm không tính.
    const groups = await this.prisma.issue.groupBy({
      by: ['sprintId'],
      where: { sprintId: { in: sprints.map((s) => s.id) }, deletedAt: null },
      _count: { _all: true },
      _sum: { storyPoints: true },
    });
    const statsBySprint = new Map(
      groups.map((g) => [g.sprintId, { count: g._count._all, points: g._sum.storyPoints ?? 0 }]),
    );
    return sprints.map((s) => {
      const st = statsBySprint.get(s.id);
      return this.toDto(s, st?.count ?? 0, st?.points ?? 0);
    });
  }

  async create(workspaceId: string, projectId: string, input: CreateSprintInput): Promise<SprintDto> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null }, select: { id: true, archivedAt: true } });
    if (!project) throw new NotFoundAppException('Dự án');
    assertNotArchived(project.archivedAt);
    // sequence = lớn nhất + 1; hai request đồng thời có thể tính trùng → unique [projectId, sequence]
    // chặn bản ghi trùng (P2002) và ta tính lại, tối đa 3 lần.
    for (let attempt = 1; ; attempt++) {
      // allow-deleted: sequence phải tính cả sprint đã xoá để không trùng số thứ tự
      const last = await this.prisma.sprint.findFirst({ where: { projectId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
      try {
        const sprint = await this.prisma.sprint.create({
          data: {
            projectId,
            boardId: input.boardId ?? null,
            name: input.name,
            goal: input.goal ?? null,
            sequence: (last?.sequence ?? 0) + 1,
            startDate: input.startDate ? new Date(input.startDate) : null,
            endDate: input.endDate ? new Date(input.endDate) : null,
          },
        });
        return this.toDto(sprint, 0, 0);
      } catch (e) {
        const isDup = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!isDup || attempt >= SEQUENCE_RETRIES) {
          if (isDup) throw new BusinessRuleException('Nhiều người đang tạo sprint cùng lúc — hãy thử tạo lại sau vài giây');
          throw e;
        }
      }
    }
  }

  async start(workspaceId: string, sprintId: string): Promise<SprintDto> {
    const sprint = await this.requireSprint(workspaceId, sprintId);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Khoá dòng project để hai request start đồng thời trong cùng project phải xếp hàng.
      await tx.project.update({ where: { id: sprint.projectId }, data: { updatedAt: new Date() }, select: { id: true } });
      // Đọc lại trạng thái SAU khi khoá: sprint đang ACTIVE/CLOSED thì báo đúng lý do thay vì "đã có sprint ACTIVE".
      const cur = await tx.sprint.findFirst({ where: { id: sprintId, deletedAt: null }, select: { state: true } });
      if (cur?.state !== 'FUTURE') throw new BusinessRuleException('Chỉ sprint FUTURE mới start được');
      const active = await tx.sprint.findFirst({ where: { projectId: sprint.projectId, state: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (active) throw new BusinessRuleException('Đã có sprint đang ACTIVE; hoàn thành nó trước');
      // Chuyển trạng thái có điều kiện: chỉ thắng khi sprint vẫn còn FUTURE.
      const { count } = await tx.sprint.updateMany({
        where: { id: sprintId, state: 'FUTURE', deletedAt: null },
        data: { state: 'ACTIVE', startDate: sprint.startDate ?? new Date() },
      });
      if (count === 0) throw new BusinessRuleException('Chỉ sprint FUTURE mới start được');
      await this.snapshot(tx, sprintId, 'START');
      return tx.sprint.findUniqueOrThrow({ where: { id: sprintId } });
    });
    this.events.emit(DOMAIN_EVENTS.SPRINT_STARTED, { sprintId, projectId: sprint.projectId });
    return this.toDto(updated);
  }

  /**
   * Hoàn thành sprint. Việc CHƯA Done đi theo `moveIncompleteTo`: về backlog, sang sprint FUTURE mới (tự tạo
   * "Sprint {số tiếp theo}") hoặc sang một sprint FUTURE có sẵn. Mọi thứ — đóng sprint, snapshot CLOSE, tạo sprint
   * mới, chuyển issue + history — nằm trong MỘT transaction: lỗi ở đâu cũng không để sprint đóng mà việc còn kẹt.
   */
  async complete(
    workspaceId: string,
    sprintId: string,
    actorId: string,
    input: CompleteSprintInput = { moveIncompleteTo: 'backlog' },
  ): Promise<SprintDto> {
    const sprint = await this.requireSprint(workspaceId, sprintId);
    const dest = input.moveIncompleteTo;
    if (typeof dest === 'object' && dest.sprintId === sprintId) {
      throw new BusinessRuleException('Không thể chuyển việc chưa xong sang chính sprint đang hoàn thành — hãy chọn sprint khác');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // Chuyển trạng thái có điều kiện: hai lần complete đồng thời chỉ một lần thắng.
      const { count } = await tx.sprint.updateMany({
        where: { id: sprintId, state: 'ACTIVE', deletedAt: null },
        data: { state: 'CLOSED', completeDate: new Date() },
      });
      if (count === 0) throw new BusinessRuleException('Chỉ sprint ACTIVE mới complete được');

      // Snapshot CLOSE chụp TOÀN BỘ sprint (cả việc sắp bị đẩy ra) — velocity cần "cam kết" thật của sprint.
      await this.snapshot(tx, sprintId, 'CLOSE');

      let targetSprintId: string | null = null;
      if (dest === 'new') {
        targetSprintId = await this.createNextSprint(tx, sprint);
      } else if (typeof dest === 'object') {
        // updateMany làm vừa khoá dòng vừa kiểm: sprint đích phải còn FUTURE, cùng dự án, chưa xoá; và
        // `remove()` (cũng updateMany trên dòng này) phải xếp hàng sau — không có việc nào trỏ vào sprint vừa bị xoá.
        const lock = await tx.sprint.updateMany({
          where: { id: dest.sprintId, projectId: sprint.projectId, state: 'FUTURE', deletedAt: null },
          data: { updatedAt: new Date() },
        });
        if (lock.count === 0) throw new BusinessRuleException('Sprint đích không còn hợp lệ — hãy chọn một sprint chưa bắt đầu (FUTURE) của dự án này');
        targetSprintId = dest.sprintId;
      }

      // Đưa issue chưa Done sang đích và ghi lịch sử cho từng issue.
      const pushed = await tx.issue.findMany({
        where: { sprintId, deletedAt: null, status: { category: { not: 'DONE' } } },
        select: { id: true },
      });
      if (pushed.length) {
        await this.moveIssuesOut(tx, { sprintId, projectId: sprint.projectId, ids: pushed.map((i) => i.id), targetSprintId, actorId, onlyNotDone: true });
      }
      return tx.sprint.findUniqueOrThrow({ where: { id: sprintId } });
    });
    this.events.emit(DOMAIN_EVENTS.SPRINT_COMPLETED, { sprintId, projectId: sprint.projectId });
    return this.toDto(updated);
  }

  /** Sửa sprint. FUTURE sửa được mọi trường; ACTIVE chỉ mục tiêu + ngày kết thúc; CLOSED không sửa. */
  async update(workspaceId: string, sprintId: string, input: UpdateSprintInput): Promise<SprintDto> {
    const sprint = await this.requireSprint(workspaceId, sprintId);
    if (sprint.state === 'CLOSED') throw new BusinessRuleException('Sprint đã hoàn thành — không sửa được nữa');
    if (sprint.state === 'ACTIVE') {
      const changesName = input.name !== undefined && input.name !== sprint.name;
      const changesStart = input.startDate !== undefined && (input.startDate ? new Date(input.startDate).getTime() : null) !== (sprint.startDate?.getTime() ?? null);
      if (changesName || changesStart) {
        throw new BusinessRuleException('Sprint đang chạy chỉ sửa được mục tiêu và ngày kết thúc — hãy bỏ phần đổi tên/ngày bắt đầu');
      }
    }
    const data: Prisma.SprintUpdateManyMutationInput = {};
    if (input.name !== undefined && sprint.state === 'FUTURE') data.name = input.name;
    if (input.goal !== undefined) data.goal = input.goal?.trim() ? input.goal : null;
    if (input.startDate !== undefined && sprint.state === 'FUTURE') data.startDate = input.startDate ? new Date(input.startDate) : null;
    if (input.endDate !== undefined) data.endDate = input.endDate ? new Date(input.endDate) : null;
    const start = 'startDate' in data ? (data.startDate as Date | null) : sprint.startDate;
    const end = 'endDate' in data ? (data.endDate as Date | null) : sprint.endDate;
    if (start && end && end < start) throw new BusinessRuleException('Ngày kết thúc phải sau ngày bắt đầu — hãy chọn lại ngày');
    // Có điều kiện theo state đã đọc: sprint vừa được start/complete/xoá giữa chừng thì không ghi đè.
    const { count } = await this.prisma.sprint.updateMany({ where: { id: sprintId, state: sprint.state, deletedAt: null }, data });
    if (count === 0) throw new BusinessRuleException('Sprint vừa đổi trạng thái — hãy tải lại trang rồi sửa lại');
    const updated = await this.prisma.sprint.findUniqueOrThrow({ where: { id: sprintId } });
    this.events.emit(DOMAIN_EVENTS.SPRINT_UPDATED, { sprintId, projectId: sprint.projectId });
    return this.toDto(updated);
  }

  /** Xoá mềm sprint FUTURE; issue trong sprint về backlog + history, cùng một transaction. */
  async remove(workspaceId: string, sprintId: string, actorId: string): Promise<{ success: true }> {
    const sprint = await this.requireSprint(workspaceId, sprintId);
    if (sprint.state !== 'FUTURE') {
      throw new BusinessRuleException('Chỉ xoá được sprint chưa bắt đầu (FUTURE) — sprint đang chạy hãy hoàn thành, sprint đã đóng được giữ làm lịch sử');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.sprint.updateMany({
        where: { id: sprintId, state: 'FUTURE', deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new BusinessRuleException('Sprint vừa được bắt đầu hoặc xoá — hãy tải lại trang');
      const issues = await tx.issue.findMany({ where: { sprintId, deletedAt: null }, select: { id: true } });
      if (issues.length) {
        await this.moveIssuesOut(tx, { sprintId, projectId: sprint.projectId, ids: issues.map((i) => i.id), targetSprintId: null, actorId, onlyNotDone: false });
      }
    });
    this.events.emit(DOMAIN_EVENTS.SPRINT_UPDATED, { sprintId, projectId: sprint.projectId });
    return { success: true };
  }

  /** Tạo sprint FUTURE kế tiếp (cùng board) bên trong transaction của `complete`. */
  private async createNextSprint(
    tx: Prisma.TransactionClient,
    from: { projectId: string; boardId: string | null },
  ): Promise<string> {
    // allow-deleted: sequence phải tính cả sprint đã xoá để không trùng số thứ tự
    const last = await tx.sprint.findFirst({ where: { projectId: from.projectId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
    const sequence = (last?.sequence ?? 0) + 1;
    try {
      const created = await tx.sprint.create({
        data: { projectId: from.projectId, boardId: from.boardId, name: `Sprint ${sequence}`, sequence, state: 'FUTURE' },
        select: { id: true },
      });
      return created.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Nhiều người đang tạo sprint cùng lúc — hãy hoàn thành sprint lại sau vài giây');
      }
      throw e;
    }
  }

  /**
   * Chuyển issue ra khỏi `sprintId` sang `targetSprintId` (null = backlog) kèm history SPRINT.
   * `version` tăng để client đang giữ bản cũ bị OCC chặn thay vì lặng lẽ ghi đè sprint.
   * Điều kiện `sprintId` ở updateMany: issue vừa bị người khác chuyển đi thì không bị kéo lại.
   */
  private async moveIssuesOut(
    tx: Prisma.TransactionClient,
    p: { sprintId: string; projectId: string; ids: string[]; targetSprintId: string | null; actorId: string; onlyNotDone: boolean },
  ): Promise<void> {
    await tx.issue.updateMany({
      where: { id: { in: p.ids }, sprintId: p.sprintId, ...(p.onlyNotDone ? { status: { category: { not: 'DONE' as const } } } : {}) },
      data: { sprintId: p.targetSprintId, version: { increment: 1 } },
    });
    const occurredAt = new Date();
    await tx.issueHistory.createMany({
      data: p.ids.map((issueId) => ({
        issueId, projectId: p.projectId, sprintId: p.sprintId, field: 'SPRINT' as const,
        oldValue: p.sprintId, newValue: p.targetSprintId, actorId: p.actorId, occurredAt,
      })),
    });
  }

  /** Chụp trạng thái sprint (dùng cho START/CLOSE ở đây và DAILY ở cron). `at` cho phép đóng dấu thời điểm khác "bây giờ". */
  async snapshot(tx: Prisma.TransactionClient, sprintId: string, kind: 'START' | 'DAILY' | 'SCOPE_CHANGE' | 'CLOSE', at: Date = new Date()) {
    const issues = await tx.issue.findMany({
      where: { sprintId, deletedAt: null },
      select: { storyPoints: true, status: { select: { category: true } } },
    });
    const committedPoints = issues.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const completedPoints = issues.filter((i) => i.status.category === 'DONE').reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const completedCount = issues.filter((i) => i.status.category === 'DONE').length;
    await tx.sprintSnapshot.create({
      data: {
        sprintId, kind, snapshotAt: at,
        committedPoints, completedPoints, remainingPoints: committedPoints - completedPoints,
        committedCount: issues.length, completedCount,
      },
    });
  }

  private async requireSprint(workspaceId: string, sprintId: string) {
    const s = await this.prisma.sprint.findFirst({
      where: { id: sprintId, deletedAt: null, project: { workspaceId } },
      include: { project: { select: { archivedAt: true } } },
    });
    if (!s) throw new NotFoundAppException('Đợt làm việc (sprint)');
    assertNotArchived(s.project.archivedAt);
    return s;
  }

  private toDto(
    s: { id: string; projectId: string; boardId: string | null; name: string; goal: string | null; state: string; startDate: Date | null; endDate: Date | null; completeDate: Date | null; sequence: number },
    issueCount?: number,
    totalPoints?: number,
  ): SprintDto {
    return {
      id: s.id, projectId: s.projectId, boardId: s.boardId, name: s.name, goal: s.goal,
      state: s.state as SprintDto['state'],
      startDate: iso(s.startDate),
      endDate: iso(s.endDate),
      completeDate: iso(s.completeDate),
      sequence: s.sequence, issueCount, totalPoints,
    };
  }
}
