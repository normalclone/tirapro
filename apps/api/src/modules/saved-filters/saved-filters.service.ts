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
import { ERROR_CODES, type FilterAudienceDto, type SavedFilterDto } from '@tirapro/types';
import { mapLimit } from '../../common/map-limit';
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

/** Trần số thành viên xét khi đếm "ai xem được" + số người mẫu trả về. */
const AUDIENCE_MEMBER_CAP = 2000;
const AUDIENCE_CONCURRENCY = 8;
const AUDIENCE_SAMPLE = 6;

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
    where: { user: { status: { not: 'DEACTIVATED' } } },
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

  /** Liệt kê bộ lọc người dùng xem được trong organization: của mình, được chia sẻ trực tiếp, hoặc qua dự án mình là thành viên. */
  async list(organizationId: string, userId: string): Promise<SavedFilterDto[]> {
    const rows = await this.prisma.savedFilter.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: await this.visibilityScope(organizationId, userId),
      },
      select: filterSelect,
      orderBy: { createdAt: 'desc' },
    });
    const visibleIds = await this.access.visibleProjectIds(userId, organizationId);
    return rows.map((r) => this.toDto(r, userId, visibleIds));
  }

  /** Tạo filter mới — validate JQL trước, ownerId = user hiện tại. Chia sẻ (nếu có) được kiểm như khi sửa. */
  async create(
    organizationId: string,
    userId: string,
    input: CreateSavedFilterInput,
  ): Promise<SavedFilterDto> {
    this.validateJql(input.jql);
    const share = this.resolveShare(null, input, userId);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertShareTargets(organizationId, userId, share, tx);
      const row = await tx.savedFilter.create({
        data: {
          organizationId,
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
    await this.notifyNewlyShared(organizationId, userId, id, input.name, share, []);
    return this.get(organizationId, userId, id);
  }

  /**
   * Cập nhật — chỉ chủ sở hữu; re-validate JQL nếu đổi. Chỉ chủ đổi được chia sẻ. Đọc trạng thái hiện tại, kiểm đích và ghi
   * nằm trong MỘT giao dịch có khoá hàng bộ lọc: hai lần lưu đồng thời chạy tuần tự (không ghi đè nhau, không báo đôi).
   */
  async update(
    organizationId: string,
    userId: string,
    id: string,
    input: UpdateSavedFilterInput,
  ): Promise<SavedFilterDto> {
    if (input.jql !== undefined) this.validateJql(input.jql);
    const sharingChanged =
      input.visibility !== undefined ||
      input.sharedProjectIds !== undefined ||
      input.sharedUserIds !== undefined;
    const { current, previousUserIds, share } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SavedFilter" WHERE "id" = ${id} FOR UPDATE`;
      const cur = await this.requireOwned(organizationId, userId, id, tx);
      const currentShare = this.shareState(cur);
      const next = this.resolveShare(currentShare, input, userId);
      if (sharingChanged) await this.assertShareTargets(organizationId, userId, next, tx);

      const data: Prisma.SavedFilterUncheckedUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.jql !== undefined) data.jql = input.jql;
      if (sharingChanged) data.visibility = next.visibility;
      if (Object.keys(data).length > 0) await tx.savedFilter.update({ where: { id }, data });
      if (sharingChanged) await this.writeShares(tx, id, next);
      return { current: cur, previousUserIds: currentShare.sharedUserIds, share: next };
    });
    if (sharingChanged) {
      await this.notifyNewlyShared(
        organizationId,
        userId,
        id,
        input.name ?? current.name,
        share,
        previousUserIds,
      );
    }
    return this.get(organizationId, userId, id);
  }

  /**
   * "Ai xem được" một bản chia sẻ (chưa cần lưu): HỢP người được chọn trực tiếp và mọi thành viên tổ chức đang hoạt động
   * xem được ÍT NHẤT MỘT dự án đã chọn — cùng luật `visibleWhere` mà phạm vi xem dùng (dự án công khai: ai xem được dự án
   * đều thấy; dự án riêng tư: thành viên + quản trị). Không đếm trùng, không tính chủ; dự án chủ không xem được bị bỏ qua
   * (khi lưu sẽ bị từ chối).
   */
  async audience(
    organizationId: string,
    ownerId: string,
    input: { sharedProjectIds: string[]; sharedUserIds: string[] },
  ): Promise<FilterAudienceDto> {
    const ownerVisible = await this.access.visibleWhere(ownerId, organizationId);
    const projectIds = input.sharedProjectIds.length
      ? (
          await this.prisma.project.findMany({
            where: {
              id: { in: input.sharedProjectIds },
              organizationId,
              deletedAt: null,
              AND: [ownerVisible],
            },
            select: { id: true },
          })
        ).map((p) => p.id)
      : [];
    const members = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId,
        userId: { not: ownerId },
        user: { status: { not: 'DEACTIVATED' } },
      },
      select: { user: { select: PERSON_SELECT } },
      take: AUDIENCE_MEMBER_CAP,
    });
    const direct = new Set(input.sharedUserIds);
    const hits = await mapLimit(members, AUDIENCE_CONCURRENCY, async (m) => {
      if (direct.has(m.user.id)) return true;
      if (projectIds.length === 0) return false;
      const visible = await this.access.visibleWhere(m.user.id, organizationId);
      const seen = await this.prisma.project.findFirst({
        where: { id: { in: projectIds }, organizationId, deletedAt: null, AND: [visible] },
        select: { id: true },
      });
      return seen !== null;
    });
    const people = members
      .filter((_, i) => hits[i])
      .map((m) => m.user)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
    return { count: people.length, people: people.slice(0, AUDIENCE_SAMPLE) };
  }

  /** Xóa mềm — chỉ chủ sở hữu. */
  async softDelete(organizationId: string, userId: string, id: string): Promise<{ success: true }> {
    await this.requireOwned(organizationId, userId, id);
    await this.prisma.savedFilter.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** Chạy filter: nạp (phải xem được) rồi ủy quyền cho SearchService chạy JQL — kết quả vẫn theo quyền NGƯỜI XEM. */
  async run(
    organizationId: string,
    userId: string,
    id: string,
    opts: RunSavedFilterOptions,
  ): Promise<PageResult<IssueDto>> {
    const filter = await this.requireVisible(organizationId, userId, id);
    return this.search.search(organizationId, userId, {
      jql: filter.jql,
      cursor: opts.cursor,
      limit: opts.limit,
    });
  }

  /**
   * Điều kiện OR cho phạm vi xem: (1) của mình; (2) người khác chia sẻ trực tiếp cho mình; (3) chia sẻ cho một dự án mà
   * mình XEM ĐƯỢC theo đúng luật hiển thị dự án (`visibleWhere`: dự án công khai thì mọi người xem được; dự án riêng tư chỉ
   * thành viên và quản trị) và dự án còn sống. Bộ lọc riêng tư của người khác thì không ai tự thấy — kể cả quản trị. Dự án
   * chuyển riêng tư / bị xoá, hoặc người xem mất quyền xem dự án (và không có chia sẻ trực tiếp) thì không còn thấy.
   */
  private async visibilityScope(
    organizationId: string,
    userId: string,
  ): Promise<Prisma.SavedFilterWhereInput[]> {
    const visible = await this.access.visibleWhere(userId, organizationId);
    return [
      { ownerId: userId },
      { visibility: FilterVisibility.SHARED, userShares: { some: { userId } } },
      {
        visibility: FilterVisibility.SHARED,
        projectShares: {
          some: {
            project: { organizationId, deletedAt: null, AND: [visible] },
          },
        },
      },
    ];
  }

  /** Một bộ lọc (đã chắc người xem thấy) → DTO. */
  private async get(organizationId: string, userId: string, id: string): Promise<SavedFilterDto> {
    const row = await this.requireVisible(organizationId, userId, id);
    return this.toDto(row, userId, await this.access.visibleProjectIds(userId, organizationId));
  }

  /** Nạp filter user xem được — nếu không có thì 404 (không phân biệt không tồn tại / không có quyền). */
  private async requireVisible(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<SavedFilterRow> {
    const row = await this.prisma.savedFilter.findFirst({
      where: {
        id,
        organizationId,
        deletedAt: null,
        OR: await this.visibilityScope(organizationId, userId),
      },
      select: filterSelect,
    });
    if (!row) throw new NotFoundAppException('Bộ lọc');
    return row;
  }

  /**
   * Nạp filter và đảm bảo user là chủ sở hữu (cho mutate): 404 nếu không tồn tại HOẶC người gọi không xem được (không lộ
   * sự tồn tại của bộ lọc riêng tư); 403 chỉ khi xem được nhưng không phải chủ. `db`: client của giao dịch đang mở.
   */
  private async requireOwned(
    organizationId: string,
    userId: string,
    id: string,
    db: Pick<Prisma.TransactionClient, 'savedFilter'> = this.prisma,
  ): Promise<SavedFilterRow> {
    const row = await db.savedFilter.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: filterSelect,
    });
    if (!row) throw new NotFoundAppException('Bộ lọc');
    if (row.ownerId !== userId) {
      await this.requireVisible(organizationId, userId, id); // 404 nếu không xem được
      throw new ForbiddenAppException('Chỉ chủ sở hữu mới sửa được bộ lọc này');
    }
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
   * Đích chia sẻ phải hợp lệ (422 mã riêng): dự án phải thuộc tổ chức, chưa xoá và CHỦ xem được (dự án riêng tư chủ không
   * thuộc cũng báo "không xem được", không phân biệt không tồn tại); người nhận phải là thành viên tổ chức đang hoạt động.
   */
  private async assertShareTargets(
    organizationId: string,
    ownerId: string,
    share: FilterShareState,
    db: Pick<Prisma.TransactionClient, 'project' | 'organizationMembership' | 'user'> = this.prisma,
  ): Promise<void> {
    if (share.sharedProjectIds.length > 0) {
      const visible = await this.access.visibleWhere(ownerId, organizationId);
      const found = await db.project.findMany({
        where: {
          id: { in: share.sharedProjectIds },
          organizationId,
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
      const members = await db.organizationMembership.findMany({
        where: {
          organizationId,
          userId: { in: userIds },
          user: { status: { not: 'DEACTIVATED' } },
        },
        select: { userId: true },
      });
      const ok = new Set(members.map((m) => m.userId));
      const bad = userIds.filter((u) => !ok.has(u));
      if (bad.length > 0) {
        const names = await db.user.findMany({
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
    organizationId: string,
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
          organizationId,
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
    // Mọi đích chia sẻ đã biến mất (dự án bị xoá, người rời đi): bộ lọc thực chất riêng tư — báo đúng thay vì "Chia sẻ · 0".
    const lapsed =
      row.visibility === FilterVisibility.SHARED &&
      row.projectShares.length + row.userShares.length === 0;
    const canSeeProject = (id: string) => isOwner || visibleIds === null || visibleIds.includes(id);
    return {
      id: row.id,
      name: row.name,
      jql: row.jql,
      visibility: lapsed ? FilterVisibility.PRIVATE : row.visibility,
      ...(lapsed && isOwner ? { shareLapsed: true } : {}),
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
