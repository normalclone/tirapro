import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TRIAGE_VISIBLE } from '../../common/triage-visibility';
import { RbacService } from '../rbac/rbac.service';
import {
  ForbiddenAppException,
  WipLimitReachedException,
} from '../../common/exceptions/app.exception';

/** Cột board có giới hạn WIP đang được áp cho một lần chuyển trạng thái. */
export interface WipColumn {
  id: string;
  name: string;
  wipLimit: number;
  statusIds: string[];
  boardType: string;
}

/** Giới hạn WIP của cột board (tìm cột, kiểm đếm trong transaction, quyền "Vẫn chuyển"). Tách từ IssuesService, không đổi hành vi. */
@Injectable()
export class WipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Cột của board chứa trạng thái đích và có giới hạn WIP. Trả null (không cần kiểm) khi: không có boardId,
   * board không thuộc dự án, trạng thái đích không nằm trong cột nào, cột không đặt giới hạn, hoặc
   * issue đã nằm sẵn trong cột đó (đổi giữa hai trạng thái cùng cột không chiếm thêm chỗ).
   */
  async resolveWipColumn(
    boardId: string | undefined,
    projectId: string,
    toStatusId: string,
    fromStatusId?: string,
  ): Promise<WipColumn | null> {
    if (!boardId) return null;
    const col = await this.prisma.boardColumn.findFirst({
      where: {
        boardId,
        board: { projectId, deletedAt: null },
        statuses: { some: { statusId: toStatusId } },
      },
      select: {
        id: true,
        name: true,
        wipLimit: true,
        board: { select: { type: true } },
        statuses: { select: { statusId: true } },
      },
    });
    if (!col || col.wipLimit == null) return null;
    const statusIds = col.statuses.map((s) => s.statusId);
    if (fromStatusId && statusIds.includes(fromStatusId)) return null;
    return {
      id: col.id,
      name: col.name,
      wipLimit: col.wipLimit,
      statusIds,
      boardType: col.board.type,
    };
  }

  /**
   * Kiểm giới hạn WIP BÊN TRONG transaction của lần ghi: khoá dòng cột (FOR UPDATE) để hai request đồng thời
   * vào cùng cột xếp hàng — request sau đếm lại sau khi request trước đã commit nên không cùng lọt qua.
   * Board SCRUM chỉ đếm việc của sprint ACTIVE (không có sprint ACTIVE = board trống, không chặn).
   * Vượt giới hạn: ném WIP_LIMIT_REACHED, trừ khi `force` và người dùng là quản trị dự án.
   */
  async enforceWip(
    tx: Prisma.TransactionClient,
    wip: WipColumn,
    ctx: {
      userId: string;
      workspaceId: string;
      projectId: string;
      incoming: number;
      force?: boolean;
    },
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "BoardColumn" WHERE "id" = ${wip.id} FOR UPDATE`;
    let sprintFilter: { sprintId: string } | Record<string, never> = {};
    if (wip.boardType === 'SCRUM') {
      const active = await tx.sprint.findFirst({
        where: { projectId: ctx.projectId, state: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!active) return;
      sprintFilter = { sprintId: active.id };
    }
    const current = await tx.issue.count({
      where: {
        projectId: ctx.projectId,
        deletedAt: null,
        statusId: { in: wip.statusIds },
        // Board ẩn việc chưa duyệt nên giới hạn WIP phải khớp số thẻ thấy được
        ...TRIAGE_VISIBLE,
        ...sprintFilter,
      },
    });
    if (current + ctx.incoming <= wip.wipLimit) return;
    if (!ctx.force) {
      const room = wip.wipLimit - current;
      throw new WipLimitReachedException(
        ctx.incoming > 1 && room > 0
          ? `Cột "${wip.name}" (giới hạn ${wip.wipLimit} việc) chỉ còn chỗ cho ${room} việc — hãy chuyển ít việc hơn hoặc chọn "Vẫn chuyển"`
          : `Cột "${wip.name}" đã đạt giới hạn ${wip.wipLimit} việc đang làm — hãy hoàn thành bớt hoặc chọn "Vẫn chuyển"`,
      );
    }
    await this.assertCanForceWip(ctx.userId, ctx.workspaceId, ctx.projectId);
  }

  /** "Vẫn chuyển" qua giới hạn WIP chỉ dành cho quản trị dự án (project/workspace admin, system admin). */
  private async assertCanForceWip(
    userId: string,
    workspaceId: string,
    projectId: string,
  ): Promise<void> {
    const perms = await this.rbac.getEffectivePermissions(userId, workspaceId, projectId);
    if (perms.has(PERMISSIONS.PROJECT_ADMIN) || perms.has(PERMISSIONS.WORKSPACE_ADMIN)) return;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true },
    });
    if (u?.isSystemAdmin) return;
    throw new ForbiddenAppException(
      'Cột đã đạt giới hạn WIP — chỉ quản trị dự án mới được chọn "Vẫn chuyển"; hãy hoàn thành bớt việc trong cột trước',
    );
  }
}
