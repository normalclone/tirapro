import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DASHBOARD_LIMITS,
  DASHBOARD_TEMPLATES,
  buildTemplateWidgets,
  findDashboardTemplate,
  type CustomDashboardDto,
  type DashboardDataScopeValue,
  type DashboardFromTemplateInput,
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
  organizationId: true,
  ownerId: true,
  projectId: true,
  teamId: true,
  name: true,
  description: true,
  scope: true,
  dataScope: true,
  scopeProjectId: true,
  scopeProgramId: true,
  updatedAt: true,
  scopeProgram: { select: { id: true, name: true } },
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
  organizationId: string;
  projectVisible: Prisma.ProjectWhereInput;
}

/**
 * DASHBOARD TUỲ BIẾN — CRUD dashboard + widget với 4 mức chia sẻ (riêng tư / cả tổ chức / theo dự án / theo nhóm).
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

  async list(organizationId: string, userId: string): Promise<CustomDashboardSummaryDto[]> {
    const ctx = await this.ctx(organizationId, userId);
    const rows = await this.prisma.dashboard.findMany({
      where: { ...dashboardVisibleWhere(ctx, organizationId, ctx.projectVisible), deletedAt: null },
      select: SUMMARY_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
    const dtos = await this.toSummaries(ctx, rows);
    return sortDashboards(dtos);
  }

  async get(organizationId: string, id: string, userId: string): Promise<CustomDashboardDto> {
    const ctx = await this.ctx(organizationId, userId);
    const row = await this.requireVisible(ctx, id);
    return this.toDetail(ctx, row);
  }

  // ------------------------------ ghi ------------------------------

  async create(
    organizationId: string,
    userId: string,
    input: DashboardInput,
  ): Promise<CustomDashboardDto> {
    const ctx = await this.ctx(organizationId, userId);
    this.assertWidgetCount(input.widgets);
    await this.assertQuota(ctx);
    const target = await this.resolveTarget(ctx, input, null);
    const data = await this.resolveDataScope(ctx, input, null);
    await this.assertWidgetProjects(ctx, input.widgets, new Set());
    const created = await this.prisma.dashboard.create({
      data: {
        organizationId,
        ownerId: userId,
        name: input.name,
        description: input.description ?? null,
        scope: input.scope,
        projectId: target.projectId,
        teamId: target.teamId,
        ...data,
        layout: LAYOUT,
        widgets: { create: input.widgets.map((w) => this.widgetData(w)) },
      },
      select: { id: true },
    });
    return this.get(organizationId, created.id, userId);
  }

  /** Thay toàn bộ dashboard + widget trong một giao dịch; `updatedAt` lệch → 409 (người khác vừa sửa). */
  async update(
    organizationId: string,
    id: string,
    userId: string,
    input: DashboardUpdateInput,
  ): Promise<CustomDashboardDto> {
    const ctx = await this.ctx(organizationId, userId);
    const row = await this.requireVisible(ctx, id);
    this.assertCanEdit(ctx, row);
    this.assertWidgetCount(input.widgets);
    const target = await this.resolveTarget(ctx, input, row);
    const data = await this.resolveDataScope(ctx, input, row);
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
          ...data,
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
    return this.get(organizationId, id, userId);
  }

  /** Mẫu dựng sẵn + người gọi có được chọn phạm vi "toàn tổ chức" không (chỉ admin tổ chức). */
  async listTemplates(
    organizationId: string,
    userId: string,
  ): Promise<{ templates: typeof DASHBOARD_TEMPLATES; canUseOrgScope: boolean }> {
    const canUseOrgScope = await this.access.seesAll(userId, organizationId);
    return { templates: DASHBOARD_TEMPLATES, canUseOrgScope };
  }

  /**
   * Tạo dashboard PRIVATE từ mẫu: mọi ô kế thừa phạm vi dữ liệu đã chọn (riêng BURNDOWN/VELOCITY cần đúng một dự án nên
   * mang `projectId` của phạm vi "một dự án"). Phạm vi do người dùng chọn rõ ràng → luôn qua cổng quyền (ORG chỉ admin).
   */
  async createFromTemplate(
    organizationId: string,
    userId: string,
    input: DashboardFromTemplateInput,
  ): Promise<CustomDashboardDto> {
    const template = findDashboardTemplate(input.templateKey);
    if (!template) throw new NotFoundAppException('Mẫu dashboard');
    if (!template.scopes.includes(input.dataScope)) {
      throw new BusinessRuleException(`Mẫu "${template.name}" không hỗ trợ phạm vi dữ liệu này`);
    }
    const ctx = await this.ctx(organizationId, userId);
    await this.assertQuota(ctx);
    const data = await this.resolveDataScope(ctx, input, null);
    const widgets = buildTemplateWidgets(
      template,
      data.dataScope,
      data.scopeProjectId ?? undefined,
    );
    this.assertWidgetCount(widgets);
    const targetName = await this.dataScopeName(ctx, data);
    const suffix = targetName ? ` · ${targetName}` : '';
    const name = (input.name ?? `${template.name}${suffix}`).slice(0, 120);
    const created = await this.prisma.dashboard.create({
      data: {
        organizationId,
        ownerId: userId,
        name,
        description: null,
        scope: 'PRIVATE',
        projectId: null,
        teamId: null,
        ...data,
        layout: LAYOUT,
        widgets: {
          create: widgets.map((w) => ({
            type: w.type,
            title: w.title,
            config: w.config,
            position: w.position,
          })),
        },
      },
      select: { id: true },
    });
    return this.get(organizationId, created.id, userId);
  }

  /** Bản sao PRIVATE của người gọi (ai thấy được thì nhân bản được) — lối để người không có quyền sửa tự chỉnh. */
  async duplicate(organizationId: string, id: string, userId: string): Promise<CustomDashboardDto> {
    const ctx = await this.ctx(organizationId, userId);
    const row = await this.requireVisible(ctx, id);
    await this.assertQuota(ctx);
    const sanitize = await this.copySanitizer(ctx, row);
    const data = await this.duplicateDataScope(ctx, row);
    const suffix = ' (bản sao)';
    const created = await this.prisma.dashboard.create({
      data: {
        organizationId,
        ownerId: userId,
        name: `${row.name.slice(0, 120 - suffix.length)}${suffix}`,
        description: row.description,
        scope: 'PRIVATE',
        projectId: null,
        teamId: null,
        ...data,
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
    return this.get(organizationId, created.id, userId);
  }

  async remove(organizationId: string, id: string, userId: string): Promise<{ success: true }> {
    const ctx = await this.ctx(organizationId, userId);
    const row = await this.requireVisible(ctx, id);
    if (!canDeleteDashboard(ctx, row)) {
      throw new ForbiddenAppException('Bạn không có quyền xoá dashboard này');
    }
    await this.prisma.dashboard.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  // ---------------------------- nội bộ ----------------------------

  private async ctx(organizationId: string, userId: string): Promise<Ctx> {
    const [isAdmin, projectVisible] = await Promise.all([
      this.access.seesAll(userId, organizationId),
      this.access.visibleWhere(userId, organizationId),
    ]);
    return { userId, isAdmin, organizationId, projectVisible };
  }

  /** Không thấy = 404 (không phân biệt "không tồn tại" — không lộ dashboard riêng tư/dự án riêng tư). */
  private async requireVisible(ctx: Ctx, id: string): Promise<DetailRow> {
    const row = await this.prisma.dashboard.findFirst({
      where: {
        id,
        ...dashboardVisibleWhere(ctx, ctx.organizationId, ctx.projectVisible),
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
      where: { organizationId: ctx.organizationId, ownerId: ctx.userId, deletedAt: null },
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
          organizationId: ctx.organizationId,
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
        where: { id: teamId, organizationId: ctx.organizationId, deletedAt: null },
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
   * Phạm vi dữ liệu sẽ lưu. Bỏ trống: tạo mới → ORG (đúng hành vi dashboard cũ, không qua cổng), sửa → giữ nguyên.
   * Chọn rõ ràng thì qua cổng: ORG chỉ admin tổ chức (giữ ORG sẵn có thì không hỏi lại, để người không phải admin vẫn sửa được
   * dashboard cũ của mình); PROJECT: người gọi phải thấy dự án (khi mới gắn/đổi); GROUP: phải là CHỦ nhóm (người khác → 404
   * như API nhóm dự án).
   */
  private async resolveDataScope(
    ctx: Ctx,
    input: {
      dataScope?: DashboardDataScopeValue;
      scopeProjectId?: string;
      scopeProgramId?: string;
    },
    current: {
      dataScope: DashboardDataScopeValue;
      scopeProjectId: string | null;
      scopeProgramId: string | null;
    } | null,
  ): Promise<{
    dataScope: DashboardDataScopeValue;
    scopeProjectId: string | null;
    scopeProgramId: string | null;
  }> {
    if (!input.dataScope) {
      return current
        ? {
            dataScope: current.dataScope,
            scopeProjectId: current.scopeProjectId,
            scopeProgramId: current.scopeProgramId,
          }
        : { dataScope: 'ORG', scopeProjectId: null, scopeProgramId: null };
    }
    if (input.dataScope === 'ORG') {
      if (current?.dataScope !== 'ORG' && !ctx.isAdmin) {
        throw new ForbiddenAppException('Chỉ Quản trị mới chọn phạm vi toàn tổ chức');
      }
      return { dataScope: 'ORG', scopeProjectId: null, scopeProgramId: null };
    }
    if (input.dataScope === 'PROJECT') {
      const projectId = input.scopeProjectId!;
      const changed = current?.dataScope !== 'PROJECT' || current.scopeProjectId !== projectId;
      const project = await this.prisma.project.findFirst({
        where: {
          id: projectId,
          organizationId: ctx.organizationId,
          deletedAt: null,
          ...(changed ? ctx.projectVisible : {}),
        },
        select: { id: true },
      });
      if (!project) throw new NotFoundAppException('Dự án');
      return { dataScope: 'PROJECT', scopeProjectId: projectId, scopeProgramId: null };
    }
    const programId = input.scopeProgramId!;
    const program = await this.prisma.program.findFirst({
      where: { id: programId, organizationId: ctx.organizationId, ownerId: ctx.userId },
      select: { id: true },
    });
    if (!program) throw new NotFoundAppException('Nhóm dự án');
    return { dataScope: 'GROUP', scopeProjectId: null, scopeProgramId: programId };
  }

  /** Tên đích của phạm vi (đặt tên mặc định cho dashboard tạo từ mẫu); ORG → rỗng. */
  private async dataScopeName(
    ctx: Ctx,
    d: {
      dataScope: DashboardDataScopeValue;
      scopeProjectId: string | null;
      scopeProgramId: string | null;
    },
  ): Promise<string> {
    if (d.dataScope === 'PROJECT' && d.scopeProjectId) {
      const p = await this.prisma.project.findFirst({
        where: { id: d.scopeProjectId, organizationId: ctx.organizationId, deletedAt: null },
        select: { name: true },
      });
      return p?.name ?? '';
    }
    if (d.dataScope === 'GROUP' && d.scopeProgramId) {
      const g = await this.prisma.program.findFirst({
        where: { id: d.scopeProgramId, organizationId: ctx.organizationId },
        select: { name: true },
      });
      return g?.name ?? '';
    }
    return '';
  }

  /**
   * Bản sao giữ phạm vi dữ liệu của bản gốc khi người nhân bản dùng được đích đó (thấy dự án / là chủ nhóm). Không dùng được
   * thì về phạm vi cũ-mặc-định ORG (= mọi dự án họ thấy, đúng hành vi trước khi có phạm vi dữ liệu) — không bao giờ gắn
   * nhóm riêng của người khác vào bản sao của mình.
   */
  private async duplicateDataScope(
    ctx: Ctx,
    row: DetailRow,
  ): Promise<{
    dataScope: DashboardDataScopeValue;
    scopeProjectId: string | null;
    scopeProgramId: string | null;
  }> {
    const fallback = { dataScope: 'ORG' as const, scopeProjectId: null, scopeProgramId: null };
    if (row.dataScope === 'PROJECT' && row.scopeProjectId) {
      const p = await this.prisma.project.findFirst({
        where: {
          id: row.scopeProjectId,
          organizationId: ctx.organizationId,
          deletedAt: null,
          ...ctx.projectVisible,
        },
        select: { id: true },
      });
      return p ? { dataScope: 'PROJECT', scopeProjectId: p.id, scopeProgramId: null } : fallback;
    }
    if (row.dataScope === 'GROUP' && row.scopeProgramId) {
      const g = await this.prisma.program.findFirst({
        where: { id: row.scopeProgramId, organizationId: ctx.organizationId, ownerId: ctx.userId },
        select: { id: true },
      });
      return g ? { dataScope: 'GROUP', scopeProjectId: null, scopeProgramId: g.id } : fallback;
    }
    return fallback;
  }

  /**
   * Dự án trong phạm vi dữ liệu mà NGƯỜI XEM thấy. `null` = ORG (mọi dự án người xem thấy — không cần lọc thêm).
   * GROUP dùng danh sách dự án hiện tại của nhóm (của chủ) giao với dự án người xem thấy: người xem khác chủ vẫn dùng danh
   * sách nhóm nhưng không bao giờ thấy dự án mình không có quyền. Nhóm đã bị xoá / dự án bị xoá → danh sách rỗng.
   */
  private async scopeProjects(
    ctx: Ctx,
    row: {
      dataScope: DashboardDataScopeValue;
      scopeProjectId: string | null;
      scopeProgramId: string | null;
    },
  ): Promise<Array<{ id: string; key: string; name: string }> | null> {
    if (row.dataScope === 'ORG') return null;
    const base = { organizationId: ctx.organizationId, deletedAt: null, ...ctx.projectVisible };
    const select = { id: true, key: true, name: true } as const;
    if (row.dataScope === 'PROJECT') {
      if (!row.scopeProjectId) return [];
      return this.prisma.project.findMany({
        where: { ...base, id: row.scopeProjectId },
        select,
      });
    }
    if (!row.scopeProgramId) return [];
    return this.prisma.project.findMany({
      where: { ...base, programLinks: { some: { programId: row.scopeProgramId } } },
      select,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * `projectId` trong config phải thuộc tổ chức và người gọi thấy được. Dự án đã nằm sẵn trong ô cũ (`alreadyStored`)
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
        organizationId: ctx.organizationId,
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
                organizationId: ctx.organizationId,
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
        organizationId: ctx.organizationId,
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
      dataScope: r.dataScope,
      scopeProjectId: r.scopeProjectId,
      scopeProgramId: r.scopeProgramId,
      scopeProgramName: r.scopeProgram?.name ?? null,
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
    const [visible, masker, scopeProjects] = await Promise.all([
      this.visibleProjectIds(ctx, [row]),
      this.jqlMasker(ctx, row),
      this.scopeProjects(ctx, row),
    ]);
    const inheritedIds = scopeProjects ? scopeProjects.map((p) => p.id) : null;
    const orderOf = (w: DetailRow['widgets'][number]) =>
      (w.position as { order?: number } | null)?.order ?? 0;
    const widgets: CustomWidgetDto[] = [...row.widgets]
      .sort((a, b) => orderOf(a) - orderOf(b))
      .map((w) => {
        const own = (w.config as { projectId?: unknown } | null)?.projectId;
        const explicit = typeof own === 'string' && own.length > 0;
        return {
          id: w.id,
          type: w.type,
          title: w.title,
          config: masker((w.config ?? {}) as Record<string, unknown>),
          position: (w.position ?? { order: 0, w: 1 }) as CustomWidgetDto['position'],
          inherits: !explicit,
          projectIds: explicit ? [own] : inheritedIds,
        };
      });
    return { ...this.summary(ctx, row, visible), widgets, scopeProjects: scopeProjects ?? null };
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
      where: { organizationId: ctx.organizationId, deletedAt: null, NOT: ctx.projectVisible },
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
