import { Injectable, Logger } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  parseJql,
  JqlParseError,
  FilterVisibility,
  resolveFilterShare,
  SHARE_TARGET_REQUIRED_MESSAGE,
  type FilterShareState,
  type IssueDto,
} from '@tirapro/shared';
import { ERROR_CODES, type SavedFilterDto } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AppException,
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import type { PageResult } from '../../common/dto/page-result';

export type { SavedFilterDto };

export interface CreateSavedFilterInput {
  name: string;
  jql: string;
  visibility?: FilterVisibility;
  sharedProjectIds?: string[];
  sharedUserIds?: string[];
}

export interface UpdateSavedFilterInput {
  name?: string;
  jql?: string;
  visibility?: FilterVisibility;
  sharedProjectIds?: string[];
  sharedUserIds?: string[];
}

export interface RunSavedFilterOptions {
  cursor?: string;
  limit: number;
}

const PERSON_SELECT = { id: true, displayName: true, avatarUrl: true } as const;

const filterSelect = {
  id: true,
  name: true,
  jql: true,
  visibility: true,
  ownerId: true,
  createdAt: true,
  owner: { select: PERSON_SELECT },
  projectShares: {
    where: { project: { deletedAt: null } },
    select: { project: { select: { id: true, key: true, name: true } } },
    orderBy: { project: { name: 'asc' } },
  },
  userShares: {
    select: { user: { select: PERSON_SELECT } },
    orderBy: { user: { displayName: 'asc' } },
  },
} satisfies Prisma.SavedFilterSelect;

type SavedFilterRow = Prisma.SavedFilterGetPayload<{ select: typeof filterSelect }>;

@Injectable()
export class SavedFiltersService {
  private readonly logger = new Logger(SavedFiltersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Liệt kê bộ lọc người dùng xem được trong workspace: của mình, được chia sẻ trực tiếp, hoặc qua dự án mình là thành viên. */
  async list(workspaceId: string, userId: string): Promise<SavedFilterDto[]> {
    const rows = await this.prisma.savedFilter.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        OR: await this.visibilityScope(workspaceId, userId),
      },
      select: filterSelect,
      orderBy: { createdAt: 'desc' },
    });
    const visibleIds = await this.access.visibleProjectIds(userId, workspaceId);
    return rows.map((r) => this.toDto(r, userId, visibleIds));
  }

  /** Tạo filter mới — validate JQL trước, ownerId = user hiện tại. Chia sẻ (nếu có) được kiểm như khi sửa. */
  async create(
    workspaceId: string,
    userId: string,
    input: CreateSavedFilterInput,
  ): Promise<SavedFilterDto> {
    this.validateJql(input.jql);
    const share = this.resolveShare(null, input, userId);
    await this.assertShareTargets(workspaceId, userId, share);
    const id = await this.prisma.$transaction(async (tx) => {
      const row = await tx.savedFilter.create({
        data: {
          workspaceId,
          ownerId: userId,
          name: input.name,
          jql: input.jql,
          visibility: share.visibility,
        },
        select: { id: true },
      });
      await this.writeShares(tx, row.id, share);
      return row.id;
    });
    await this.notifyNewlyShared(workspaceId, userId, id, input.name, share, []);
    return this.get(workspaceId, userId, id);
  }

  /** Cập nhật — chỉ chủ sở hữu; re-validate JQL nếu đổi. Chỉ chủ đổi được chia sẻ. */
  async update(
    workspaceId: string,
    userId: string,
    id: string,
    input: UpdateSavedFilterInput,
  ): Promise<SavedFilterDto> {
    const current = await this.requireOwned(workspaceId, userId, id);
    if (input.jql !== undefined) this.validateJql(input.jql);
    const currentShare = this.shareState(current);
    const share = this.resolveShare(currentShare, input, userId);
    const sharingChanged =
      input.visibility !== undefined ||
      input.sharedProjectIds !== undefined ||
      input.sharedUserIds !== undefined;
    if (sharingChanged) await this.assertShareTargets(workspaceId, userId, share);

    const data: Prisma.SavedFilterUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.jql !== undefined) data.jql = input.jql;
    if (sharingChanged) data.visibility = share.visibility;
    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) await tx.savedFilter.update({ where: { id }, data });
      if (sharingChanged) await this.writeShares(tx, id, share);
    });
    if (sharingChanged) {
      await this.notifyNewlyShared(
        workspaceId,
        userId,
        id,
        input.name ?? current.name,
        share,
        currentShare.sharedUserIds,
      );
    }
    return this.get(workspaceId, userId, id);
  }

  /** Xóa mềm — chỉ chủ sở hữu. */
  async softDelete(workspaceId: string, userId: string, id: string): Promise<{ success: true }> {
    await this.requireOwned(workspaceId, userId, id);
    await this.prisma.savedFilter.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** Chạy filter: nạp (phải xem được) rồi ủy quyền cho SearchService chạy JQL — kết quả vẫn theo quyền NGƯỜI XEM. */
  async run(
    workspaceId: string,
    userId: string,
    id: string,
    opts: RunSavedFilterOptions,
  ): Promise<PageResult<IssueDto>> {
    const filter = await this.requireVisible(workspaceId, userId, id);
    return this.search.search(workspaceId, userId, {
      jql: filter.jql,
      cursor: opts.cursor,
      limit: opts.limit,
    });
  }

  /**
   * Điều kiện OR cho phạm vi xem: (1) của mình; (2) người khác chia sẻ trực tiếp cho mình; (3) chia sẻ cho một dự án mình
   * là THÀNH VIÊN (và còn xem được, chưa xoá). Không ai khác — kể cả quản trị — tự thấy bộ lọc riêng tư của người khác.
   * Người mất tư cách thành viên dự án (và không có chia sẻ trực tiếp) thì không còn thấy.
   */
  private async visibilityScope(
    workspaceId: string,
    userId: string,
  ): Promise<Prisma.SavedFilterWhereInput[]> {
    const visible = await this.access.visibleWhere(userId, workspaceId);
    return [
      { ownerId: userId },
      { visibility: FilterVisibility.SHARED, userShares: { some: { userId } } },
      {
        visibility: FilterVisibility.SHARED,
        projectShares: {
          some: {
            project: {
              workspaceId,
              deletedAt: null,
              AND: [visible, { memberships: { some: { userId } } }],
            },
          },
        },
      },
    ];
  }

  /** Một bộ lọc (đã chắc người xem thấy) → DTO. */
  private async get(workspaceId: string, userId: string, id: string): Promise<SavedFilterDto> {
    const row = await this.requireVisible(workspaceId, userId, id);
    return this.toDto(row, userId, await this.access.visibleProjectIds(userId, workspaceId));
  }

  /** Nạp filter user xem được — nếu không có thì 404 (không phân biệt không tồn tại / không có quyền). */
  private async requireVisible(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<SavedFilterRow> {
    const row = await this.prisma.savedFilter.findFirst({
      where: {
        id,
        workspaceId,
        deletedAt: null,
        OR: await this.visibilityScope(workspaceId, userId),
      },
      select: filterSelect,
    });
    if (!row) throw new NotFoundAppException('Bộ lọc');
    return row;
  }

  /** Nạp filter và đảm bảo user là chủ sở hữu (cho mutate) — 404 nếu không tồn tại, 403 nếu không phải chủ. */
  private async requireOwned(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<SavedFilterRow> {
    const row = await this.prisma.savedFilter.findFirst({
      where: { id, workspaceId, deletedAt: null },
      select: filterSelect,
    });
    if (!row) throw new NotFoundAppException('Bộ lọc');
    if (row.ownerId !== userId)
      throw new ForbiddenAppException('Chỉ chủ sở hữu mới sửa được bộ lọc này');
    return row;
  }

  private shareState(row: SavedFilterRow): FilterShareState {
    return {
      visibility: row.visibility,
      sharedProjectIds: row.projectShares.map((s) => s.project.id),
      sharedUserIds: row.userShares.map((s) => s.user.id),
    };
  }

  /** Trạng thái chia sẻ sau khi áp `input` (xem `resolveFilterShare`); thiếu đích → 422. */
  private resolveShare(
    current: FilterShareState | null,
    input: { visibility?: FilterVisibility; sharedProjectIds?: string[]; sharedUserIds?: string[] },
    ownerId: string,
  ): FilterShareState {
    const r = resolveFilterShare(current, input);
    if (r.value === null) throw new BusinessRuleException(r.error);
    // Chủ luôn thấy bộ lọc của mình: không lưu chính chủ làm người nhận (cũng không tự báo cho mình).
    const value = { ...r.value, sharedUserIds: r.value.sharedUserIds.filter((u) => u !== ownerId) };
    if (
      value.visibility === FilterVisibility.SHARED &&
      value.sharedProjectIds.length + value.sharedUserIds.length === 0
    )
      throw new BusinessRuleException(SHARE_TARGET_REQUIRED_MESSAGE);
    return value;
  }

  /**
   * Đích chia sẻ phải hợp lệ (422 mã riêng): dự án phải thuộc workspace, chưa xoá và CHỦ xem được (dự án riêng tư chủ không
   * thuộc cũng báo "không xem được", không phân biệt không tồn tại); người nhận phải là thành viên workspace đang hoạt động.
   */
  private async assertShareTargets(
    workspaceId: string,
    ownerId: string,
    share: FilterShareState,
  ): Promise<void> {
    if (share.sharedProjectIds.length > 0) {
      const visible = await this.access.visibleWhere(ownerId, workspaceId);
      const found = await this.prisma.project.findMany({
        where: {
          id: { in: share.sharedProjectIds },
          workspaceId,
          deletedAt: null,
          ...visible,
        },
        select: { id: true },
      });
      if (found.length !== share.sharedProjectIds.length) {
        throw new AppException(
          ERROR_CODES.FILTER_SHARE_PROJECT_NOT_VISIBLE,
          'Không chia sẻ được cho dự án bạn không xem được hoặc không tồn tại',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    const userIds = share.sharedUserIds;
    if (userIds.length > 0) {
      const members = await this.prisma.workspaceMembership.findMany({
        where: {
          workspaceId,
          userId: { in: userIds },
          user: { status: { not: 'DEACTIVATED' } },
        },
        select: { userId: true },
      });
      const ok = new Set(members.map((m) => m.userId));
      const bad = userIds.filter((u) => !ok.has(u));
      if (bad.length > 0) {
        const names = await this.prisma.user.findMany({
          where: { id: { in: bad } },
          select: { displayName: true },
        });
        const list = names.map((n) => n.displayName).join(', ');
        throw new AppException(
          ERROR_CODES.FILTER_SHARE_USER_NOT_MEMBER,
          `Không chia sẻ được cho ${list || `${bad.length} người`} — chỉ chia sẻ cho thành viên của tổ chức này`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
  }

  /** Thay toàn bộ dòng chia sẻ bằng `share` (chủ không được tự chia sẻ cho mình). */
  private async writeShares(
    tx: Prisma.TransactionClient,
    filterId: string,
    share: FilterShareState,
  ): Promise<void> {
    const users = share.sharedUserIds;
    await tx.savedFilterProjectShare.deleteMany({
      where: { filterId, projectId: { notIn: share.sharedProjectIds } },
    });
    await tx.savedFilterUserShare.deleteMany({ where: { filterId, userId: { notIn: users } } });
    if (share.sharedProjectIds.length > 0) {
      await tx.savedFilterProjectShare.createMany({
        data: share.sharedProjectIds.map((projectId) => ({ filterId, projectId })),
        skipDuplicates: true,
      });
    }
    if (users.length > 0) {
      await tx.savedFilterUserShare.createMany({
        data: users.map((userId) => ({ filterId, userId })),
        skipDuplicates: true,
      });
    }
  }

  /** Mỗi người MỚI được thêm vào danh sách người nhận một thông báo; người đã có từ trước thì không báo lại. */
  private async notifyNewlyShared(
    workspaceId: string,
    ownerId: string,
    filterId: string,
    filterName: string,
    share: FilterShareState,
    previousUserIds: readonly string[],
  ): Promise<void> {
    if (share.visibility !== FilterVisibility.SHARED) return;
    const before = new Set(previousUserIds);
    for (const recipientId of share.sharedUserIds) {
      if (before.has(recipientId) || recipientId === ownerId) continue;
      try {
        await this.notifications.publish({
          recipientId,
          workspaceId,
          type: 'FILTER_SHARED',
          actorId: ownerId,
          payload: { filterId, filterName },
        });
      } catch (e) {
        // Thông báo là phần phụ: không làm hỏng việc lưu chia sẻ.
        this.logger.warn(`Không gửi được thông báo chia sẻ bộ lọc: ${(e as Error).message}`);
      }
    }
  }

  /** Validate cú pháp JQL; ném BusinessRuleException kèm message + vị trí khi sai. */
  private validateJql(jql: string): void {
    try {
      parseJql(jql);
    } catch (e) {
      if (e instanceof JqlParseError) {
        throw new BusinessRuleException(`JQL không hợp lệ: ${e.message} (vị trí ${e.position})`);
      }
      throw e;
    }
  }

  /**
   * Chủ thấy đủ danh sách chia sẻ. Người khác chỉ thấy dự án HỌ xem được (không lộ tên dự án riêng tư khác) và chính mình
   * trong danh sách người (không lộ ai khác được chia sẻ). `visibleIds`: `null` = thấy mọi dự án.
   */
  private toDto(row: SavedFilterRow, userId: string, visibleIds: string[] | null): SavedFilterDto {
    const isOwner = row.ownerId === userId;
    const canSeeProject = (id: string) => isOwner || visibleIds === null || visibleIds.includes(id);
    return {
      id: row.id,
      name: row.name,
      jql: row.jql,
      visibility: row.visibility,
      ownerId: row.ownerId,
      isOwner,
      access: isOwner ? 'owner' : 'shared',
      owner: row.owner,
      sharedProjects: row.projectShares.map((s) => s.project).filter((p) => canSeeProject(p.id)),
      sharedUsers: row.userShares.map((s) => s.user).filter((u) => isOwner || u.id === userId),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
