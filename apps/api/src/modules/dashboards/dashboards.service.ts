import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DASHBOARD_LIMITS,
  type CustomDashboardDto,
  type DashboardInput,
  type DashboardScopeValue,
  type CustomDashboardSummaryDto,
  type DashboardUpdateInput,
  type CustomWidgetDto,
  type WidgetInput,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { assertNotArchived } from '../../common/project-writable';
import { ProjectAccessService } from '../rbac/project-access.service';
import {
  canDeleteDashboard,
  canEditDashboard,
  dashboardVisibleWhere,
  sortDashboards,
  type DashboardViewer,
} from './dashboard-access';

const LAYOUT = { version: 1, columns: 3 } as const;

const SUMMARY_SELECT = {
  id: true,
  workspaceId: true,
  ownerId: true,
  projectId: true,
  teamId: true,
  name: true,
  description: true,
  scope: true,
  updatedAt: true,
  owner: { select: { id: true, displayName: true, avatarUrl: true } },
  project: { select: { id: true, key: true, name: true } },
  team: { select: { id: true, name: true, leadId: true } },
  _count: { select: { widgets: true } },
} satisfies Prisma.DashboardSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  widgets: { select: { id: true, type: true, title: true, config: true, position: true } },
} satisfies Prisma.DashboardSelect;

type SummaryRow = Prisma.DashboardGetPayload<{ select: typeof SUMMARY_SELECT }>;
type DetailRow = Prisma.DashboardGetPayload<{ select: typeof DETAIL_SELECT }>;

/** Người gọi + bộ lọc dự án đã phân giải một lần cho cả lượt xử lý. */
interface Ctx extends DashboardViewer {
  workspaceId: string;
  projectVisible: Prisma.ProjectWhereInput;
}

/**
 * DASHBOARD TUỲ BIẾN — CRUD dashboard + widget với 4 mức chia sẻ (riêng tư / cả workspace / theo dự án / theo nhóm).
 * Quyền thấy/sửa nằm ở `dashboard-access.ts` (một nơi duy nhất). Dữ liệu TRONG ô KHÔNG kế thừa quyền người tạo:
 * mỗi ô gọi API với quyền của người xem (đọc chéo dự án đã lọc dự án riêng tư), nên chia sẻ dashboard không làm lộ dữ liệu.
 * Dashboard theo dự án vẫn gọi `assertNotArchived` khi tạo/sửa.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  // ------------------------------ đọc ------------------------------

  async list(workspaceId: string, userId: string): Promise<CustomDashboardSummaryDto[]> {
    const ctx = await this.ctx(workspaceId, userId);
    const rows = await this.prisma.dashboard.findMany({
      where: { ...dashboardVisibleWhere(ctx, workspaceId, ctx.projectVisible), deletedAt: null },
      select: SUMMARY_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
    const dtos = await this.toSummaries(ctx, rows);
    return sortDashboards(dtos);
  }

  async get(workspaceId: string, id: string, userId: string): Promise<CustomDashboardDto> {
    const ctx = await this.ctx(workspaceId, userId);
    const row = await this.requireVisible(ctx, id);
    return this.toDetail(ctx, row);
  }

  // ------------------------------ ghi ------------------------------

  async create(
    workspaceId: string,
    userId: string,
    input: DashboardInput,
  ): Promise<CustomDashboardDto> {
    const ctx = await this.ctx(workspaceId, userId);
    this.assertWidgetCount(input.widgets);
    await this.assertQuota(ctx);
    const target = await this.resolveTarget(ctx, input, null);
    await this.assertWidgetProjects(ctx, input.widgets, new Set());
    const created = await this.prisma.dashboard.create({
      data: {
        workspaceId,
        ownerId: userId,
        name: input.name,
        description: input.description ?? null,
        scope: input.scope,
        projectId: target.projectId,
        teamId: target.teamId,
        layout: LAYOUT,
        widgets: { create: input.widgets.map((w) => this.widgetData(w)) },
      },
      select: { id: true },
    });
    return this.get(workspaceId, created.id, userId);
  }

  /** Thay toàn bộ dashboard + widget trong một giao dịch; `updatedAt` lệch → 409 (người khác vừa sửa). */
  async update(
    workspaceId: string,
    id: string,
    userId: string,
    input: DashboardUpdateInput,
  ): Promise<CustomDashboardDto> {
    const ctx = await this.ctx(workspaceId, userId);
    const row = await this.requireVisible(ctx, id);
    this.assertCanEdit(ctx, row);
    this.assertWidgetCount(input.widgets);
    const target = await this.resolveTarget(ctx, input, row);
    const stored = new Set(
      row.widgets
        .map((w) => (w.config as { projectId?: unknown } | null)?.projectId)
        .filter((v): v is string => typeof v === 'string'),
    );
    await this.assertWidgetProjects(ctx, input.widgets, stored);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.dashboard.updateMany({
        where: { id, deletedAt: null, updatedAt: new Date(input.updatedAt) },
        data: {
          name: input.name,
          description: input.description ?? null,
          scope: input.scope,
          projectId: target.projectId,
          teamId: target.teamId,
        },
      });
      if (count === 0) {
        throw new VersionConflictException('Dashboard vừa được người khác sửa — tải lại');
      }
      // Danh sách widget gửi lên = danh sách MỚI: có id (còn tồn tại) → update, không id → create, thiếu → xoá.
      const existing = await tx.widget.findMany({
        where: { dashboardId: id },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((w) => w.id));
      const keep = new Set(input.widgets.map((w) => w.id).filter((v): v is string => !!v));
      const removed = existing.filter((w) => !keep.has(w.id)).map((w) => w.id);
      if (removed.length > 0) {
        await tx.widget.deleteMany({ where: { dashboardId: id, id: { in: removed } } });
      }
      for (const w of input.widgets) {
        if (w.id && existingIds.has(w.id)) {
          await tx.widget.update({ where: { id: w.id }, data: this.widgetData(w) });
        } else {
          await tx.widget.create({ data: { dashboardId: id, ...this.widgetData(w) } });
        }
      }
    });
    return this.get(workspaceId, id, userId);
  }

  /** Bản sao PRIVATE của người gọi (ai thấy được thì nhân bản được) — lối để người không có quyền sửa tự chỉnh. */
  async duplicate(workspaceId: string, id: string, userId: string): Promise<CustomDashboardDto> {
    const ctx = await this.ctx(workspaceId, userId);
    const row = await this.requireVisible(ctx, id);
    await this.assertQuota(ctx);
    const sanitize = await this.copySanitizer(ctx, row);
    const suffix = ' (bản sao)';
    const created = await this.prisma.dashboard.create({
      data: {
        workspaceId,
        ownerId: userId,
        name: `${row.name.slice(0, 120 - suffix.length)}${suffix}`,
        description: row.description,
        scope: 'PRIVATE',
        projectId: null,
        teamId: null,
        layout: LAYOUT,
        widgets: {
          create: row.widgets.map((w) => ({
            type: w.type,
            title: w.title,
            config: sanitize((w.config ?? {}) as Record<string, unknown>) as Prisma.InputJsonValue,
            position: w.position as Prisma.InputJsonValue,
          })),
        },
      },
      select: { id: true },
    });
    return this.get(workspaceId, created.id, userId);
  }

  async remove(workspaceId: string, id: string, userId: string): Promise<{ success: true }> {
    const ctx = await this.ctx(workspaceId, userId);
    const row = await this.requireVisible(ctx, id);
    if (!canDeleteDashboard(ctx, row)) {
      throw new ForbiddenAppException('Bạn không có quyền xoá dashboard này');
    }
    await this.prisma.dashboard.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  // ---------------------------- nội bộ ----------------------------

  private async ctx(workspaceId: string, userId: string): Promise<Ctx> {
    const [isAdmin, projectVisible] = await Promise.all([
      this.access.seesAll(userId, workspaceId),
      this.access.visibleWhere(userId, workspaceId),
    ]);
    return { userId, isAdmin, workspaceId, projectVisible };
  }

  /** Không thấy = 404 (không phân biệt "không tồn tại" — không lộ dashboard riêng tư/dự án riêng tư). */
  private async requireVisible(ctx: Ctx, id: string): Promise<DetailRow> {
    const row = await this.prisma.dashboard.findFirst({
      where: {
        id,
        ...dashboardVisibleWhere(ctx, ctx.workspaceId, ctx.projectVisible),
        deletedAt: null,
      },
      select: DETAIL_SELECT,
    });
    if (!row) throw new NotFoundAppException('Dashboard');
    return row;
  }

  /** Chỉ CHỦ sửa nội dung/đổi mức chia sẻ (admin chỉ được xoá để kiểm duyệt); người khác nhân bản. */
  private assertCanEdit(ctx: Ctx, row: SummaryRow): void {
    if (!canEditDashboard(ctx, row)) {
      throw new ForbiddenAppException(
        'Chỉ người tạo mới sửa được dashboard này — hãy nhân bản để chỉnh bản của riêng bạn',
      );
    }
  }

  private assertWidgetCount(widgets: readonly unknown[]): void {
    if (widgets.length > DASHBOARD_LIMITS.widgetsPerDashboard) {
      throw new BusinessRuleException(
        `Một dashboard tối đa ${DASHBOARD_LIMITS.widgetsPerDashboard} ô`,
      );
    }
  }

  private async assertQuota(ctx: Ctx): Promise<void> {
    const owned = await this.prisma.dashboard.count({
      where: { workspaceId: ctx.workspaceId, ownerId: ctx.userId, deletedAt: null },
    });
    if (owned >= DASHBOARD_LIMITS.dashboardsPerOwner) {
      throw new BusinessRuleException(
        `Mỗi người tạo tối đa ${DASHBOARD_LIMITS.dashboardsPerOwner} dashboard — hãy xoá bớt trước`,
      );
    }
  }

  /**
   * Kiểm đích chia sẻ và trả `{projectId, teamId}` sẽ lưu (id không còn dùng bị xoá khi đổi mức).
   * PROJECT: người gọi phải thấy dự án (khi mới gắn/đổi dự án) và dự án chưa lưu trữ (mọi lần tạo/sửa);
   * TEAM: người gọi là thành viên/trưởng nhóm, hoặc admin (khi mới gắn/đổi nhóm).
   */
  private async resolveTarget(
    ctx: Ctx,
    input: { scope: DashboardScopeValue; projectId?: string; teamId?: string },
    current: { scope: DashboardScopeValue; projectId: string | null; teamId: string | null } | null,
  ): Promise<{ projectId: string | null; teamId: string | null }> {
    if (input.scope === 'PROJECT') {
      const projectId = input.projectId!;
      const changed = !current || current.scope !== 'PROJECT' || current.projectId !== projectId;
      const project = await this.prisma.project.findFirst({
        where: {
          id: projectId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...(changed ? ctx.projectVisible : {}),
        },
        select: { id: true, archivedAt: true },
      });
      if (!project) throw new NotFoundAppException('Dự án');
      assertNotArchived(project.archivedAt);
      return { projectId, teamId: null };
    }
    if (input.scope === 'TEAM') {
      const teamId = input.teamId!;
      const changed = !current || current.scope !== 'TEAM' || current.teamId !== teamId;
      const team = await this.prisma.team.findFirst({
        where: { id: teamId, workspaceId: ctx.workspaceId, deletedAt: null },
        select: {
          id: true,
          leadId: true,
          members: { where: { userId: ctx.userId }, select: { userId: true } },
        },
      });
      if (!team) throw new NotFoundAppException('Nhóm');
      const belongs = team.leadId === ctx.userId || team.members.length > 0;
      if (changed && !belongs && !ctx.isAdmin) {
        throw new ForbiddenAppException('Bạn chỉ chia sẻ được cho nhóm mà bạn là thành viên');
      }
      return { projectId: null, teamId };
    }
    return { projectId: null, teamId: null };
  }

  /**
   * `projectId` trong config phải thuộc workspace và người gọi thấy được. Dự án đã nằm sẵn trong ô cũ (`alreadyStored`)
   * không bị kiểm lại — người sửa dashboard chung không bị chặn vì một ô của người khác trỏ dự án họ không thấy.
   */
  private async assertWidgetProjects(
    ctx: Ctx,
    widgets: readonly WidgetInput[],
    alreadyStored: Set<string>,
  ): Promise<void> {
    const ids = new Set<string>();
    for (const w of widgets) {
      const pid = (w.config as { projectId?: unknown }).projectId;
      if (typeof pid === 'string' && !alreadyStored.has(pid)) ids.add(pid);
    }
    if (ids.size === 0) return;
    const found = await this.prisma.project.findMany({
      where: {
        id: { in: [...ids] },
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        ...ctx.projectVisible,
      },
      select: { id: true },
    });
    if (found.length !== ids.size) {
      throw new BusinessRuleException(
        'Có ô trỏ tới dự án không tồn tại hoặc bạn không có quyền xem',
      );
    }
  }

  /**
   * Bản sao thuộc về người nhân bản nên `get` sẽ trả cấu hình KHÔNG che: chỉ được giữ phần cấu hình người nhân bản tự xem
   * được. JQL nhắc dự án họ không thấy (cùng `jqlMasker`) bị bỏ thành chuỗi rỗng; `projectId` của dự án họ không thấy bị
   * bỏ khỏi config (ô hiện "cần chọn lại dự án"). Cờ `masked` không mang sang bản sao.
   */
  private async copySanitizer(
    ctx: Ctx,
    row: DetailRow,
  ): Promise<(config: Record<string, unknown>) => Record<string, unknown>> {
    const ids = [
      ...new Set(
        row.widgets.flatMap((w) => {
          const pid = (w.config as { projectId?: unknown } | null)?.projectId;
          return typeof pid === 'string' ? [pid] : [];
        }),
      ),
    ];
    const [masker, visible] = await Promise.all([
      this.jqlMasker(ctx, row),
      ids.length === 0 || ctx.isAdmin
        ? Promise.resolve(null)
        : this.prisma.project
            .findMany({
              where: {
                id: { in: ids },
                workspaceId: ctx.workspaceId,
                deletedAt: null,
                ...ctx.projectVisible,
              },
              select: { id: true },
            })
            .then((found) => new Set(found.map((p) => p.id))),
    ]);
    return (config) => {
      const { masked: _masked, ...rest } = masker(config);
      const pid = rest.projectId;
      if (visible && typeof pid === 'string' && !visible.has(pid)) delete rest.projectId;
      return rest;
    };
  }

  private widgetData(w: WidgetInput) {
    return {
      type: w.type,
      title: w.title,
      config: w.config as Prisma.InputJsonValue,
      position: w.position as Prisma.InputJsonValue,
    };
  }

  // ------------------------------ DTO ------------------------------

  /**
   * Tên dự án chỉ trả khi người xem còn thấy dự án đó (chủ đã mất quyền vẫn thấy dashboard của mình nhưng không biết tên dự án mật).
   * Một truy vấn cho cả lô.
   */
  private async visibleProjectIds(
    ctx: Ctx,
    rows: readonly SummaryRow[],
  ): Promise<Set<string> | null> {
    if (ctx.isAdmin) return null; // thấy hết
    const ids = [...new Set(rows.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
    if (ids.length === 0) return new Set();
    const found = await this.prisma.project.findMany({
      where: {
        id: { in: ids },
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        ...ctx.projectVisible,
      },
      select: { id: true },
    });
    return new Set(found.map((p) => p.id));
  }

  private async toSummaries(ctx: Ctx, rows: SummaryRow[]): Promise<CustomDashboardSummaryDto[]> {
    const visible = await this.visibleProjectIds(ctx, rows);
    return rows.map((r) => this.summary(ctx, r, visible));
  }

  private summary(
    ctx: Ctx,
    r: SummaryRow,
    visibleProjects: Set<string> | null,
  ): CustomDashboardSummaryDto {
    const showProject =
      r.project && (visibleProjects === null || visibleProjects.has(r.project.id));
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      scope: r.scope,
      widgetCount: r._count.widgets,
      isMine: r.ownerId === ctx.userId,
      canEdit: canEditDashboard(ctx, r),
      canDelete: canDeleteDashboard(ctx, r),
      owner: r.owner,
      project: showProject && r.project ? r.project : null,
      team: r.team ? { id: r.team.id, name: r.team.name } : null,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async toDetail(ctx: Ctx, row: DetailRow): Promise<CustomDashboardDto> {
    const [visible, masker] = await Promise.all([
      this.visibleProjectIds(ctx, [row]),
      this.jqlMasker(ctx, row),
    ]);
    const orderOf = (w: DetailRow['widgets'][number]) =>
      (w.position as { order?: number } | null)?.order ?? 0;
    const widgets: CustomWidgetDto[] = [...row.widgets]
      .sort((a, b) => orderOf(a) - orderOf(b))
      .map((w) => ({
        id: w.id,
        type: w.type,
        title: w.title,
        config: masker((w.config ?? {}) as Record<string, unknown>),
        position: (w.position ?? { order: 0, w: 1 }) as CustomWidgetDto['position'],
      }));
    return { ...this.summary(ctx, row, visible), widgets };
  }

  /**
   * Người XEM (không phải chủ, không phải admin) không được đọc chuỗi `jql` có nhắc tới dự án họ không thấy (mã dự án =
   * thông tin về dự án riêng tư). Ô đó trả `jql: ''` + `masked: true` — dữ liệu vốn đã lọc theo quyền người xem, đây chỉ
   * che phần cấu hình. Chủ dashboard thấy nguyên văn (họ tự viết).
   */
  private async jqlMasker(
    ctx: Ctx,
    row: DetailRow,
  ): Promise<(config: Record<string, unknown>) => Record<string, unknown>> {
    const identity = (c: Record<string, unknown>) => c;
    const hasJql = row.widgets.some(
      (w) => typeof (w.config as { jql?: unknown })?.jql === 'string',
    );
    if (!hasJql || ctx.isAdmin || row.ownerId === ctx.userId) return identity;
    const hidden = await this.prisma.project.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, NOT: ctx.projectVisible },
      select: { id: true, key: true },
    });
    if (hidden.length === 0) return identity;
    const tokens = hidden.flatMap((p) => [p.key.toLowerCase(), p.id.toLowerCase()]);
    return (config) => {
      const jql = config.jql;
      if (typeof jql !== 'string') return config;
      const words = new Set(jql.toLowerCase().match(/[a-z0-9_-]+/g) ?? []);
      // Khoá issue dạng KEY-12 cũng nhắc tới dự án: tách phần trước dấu '-' cuối.
      const mentions = tokens.some(
        (t) => words.has(t) || [...words].some((w) => w.startsWith(`${t}-`)),
      );
      return mentions ? { ...config, jql: '', masked: true } : config;
    };
  }
}
