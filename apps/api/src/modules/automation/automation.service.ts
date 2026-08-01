import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { IssuesService } from '../issues/issues.service';
import { RbacService } from '../rbac/rbac.service';
import {
  issuePayloadSchema,
  type CreateRecurringInput,
  type CreateTemplateInput,
  type IssuePayload,
  type UpdateRecurringInput,
  type UpdateTemplateInput,
} from './automation.schemas';
import { computeNextRun, nextRunAfterRun, type Freq, type RecurrenceConfig } from './recurrence';

/** Giá trị `projectId` đặc biệt trên query: chỉ lấy mục dùng chung (không gắn dự án). */
const SCOPE_SHARED = 'none';

/** Quét việc lặp lại mỗi 15 phút (giây 0). */
const EVERY_15_MINUTES = '0 */15 * * * *';

const PROJECT_BRIEF = { select: { id: true, key: true, name: true } } as const;

type TemplateRow = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  project: { id: string; key: string; name: string } | null;
};

type RecurringRow = {
  id: string;
  projectId: string;
  name: string;
  freq: string;
  interval: number;
  weekday: number | null;
  monthDay: number | null;
  hour: number;
  payload: Prisma.JsonValue;
  active: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  project: { id: string; key: string; name: string };
};

export interface IssueTemplateDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  project: { id: string; key: string; name: string } | null;
  name: string;
  description: string | null;
  payload: IssuePayload;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringIssueDto {
  id: string;
  projectId: string;
  project: { id: string; key: string; name: string };
  name: string;
  freq: Freq;
  interval: number;
  weekday: number | null;
  monthDay: number | null;
  hour: number;
  payload: IssuePayload;
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tự động hoá: MẪU ISSUE (điền sẵn trường khi tạo issue) và VIỆC LẶP LẠI
 * (cron sinh issue định kỳ). Cron bọc try/catch từng bản ghi — lỗi một việc
 * không làm hỏng lượt quét, cũng không bao giờ ném ra ngoài.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
    private readonly rbac: RbacService,
  ) {}

  /* ============================== Mẫu issue ============================== */

  /** `projectId` bỏ trống = mọi mẫu; `none` = mẫu dùng chung; id dự án = mẫu của dự án + mẫu dùng chung. */
  async listTemplates(workspaceId: string, projectId?: string): Promise<IssueTemplateDto[]> {
    const rows = await this.prisma.issueTemplate.findMany({
      where: { workspaceId, ...this.templateScope(projectId) },
      orderBy: [{ name: 'asc' }],
      include: { project: PROJECT_BRIEF },
    });
    return rows.map((r) => this.toTemplateDto(r));
  }

  async getTemplate(workspaceId: string, id: string): Promise<IssueTemplateDto> {
    const row = await this.prisma.issueTemplate.findFirst({
      where: { id, workspaceId },
      include: { project: PROJECT_BRIEF },
    });
    if (!row) throw new NotFoundAppException('Mẫu công việc');
    return this.toTemplateDto(row);
  }

  async createTemplate(workspaceId: string, dto: CreateTemplateInput, actingUserId: string): Promise<IssueTemplateDto> {
    const name = dto.name.trim();
    if (!name) throw new BusinessRuleException('Tên mẫu bắt buộc');
    const projectId = dto.projectId ?? null;
    if (projectId) {
      await this.requireProject(workspaceId, projectId);
      await this.assertProjectAdmin(actingUserId, workspaceId, projectId);
    }

    const created = await this.prisma.issueTemplate.create({
      data: {
        workspaceId,
        projectId,
        name,
        description: dto.description ?? null,
        payload: this.cleanPayload(dto.payload) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return this.getTemplate(workspaceId, created.id);
  }

  async updateTemplate(workspaceId: string, id: string, dto: UpdateTemplateInput, actingUserId: string): Promise<IssueTemplateDto> {
    const cur = await this.getTemplate(workspaceId, id);
    if (cur.projectId) await this.assertProjectAdmin(actingUserId, workspaceId, cur.projectId);
    const data: Prisma.IssueTemplateUpdateInput = {};

    if (dto.name !== undefined) {
      const name = (dto.name ?? '').trim();
      if (!name) throw new BusinessRuleException('Tên mẫu bắt buộc');
      data.name = name;
    }
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (dto.projectId !== undefined) {
      if (dto.projectId) {
        await this.requireProject(workspaceId, dto.projectId);
        await this.assertProjectAdmin(actingUserId, workspaceId, dto.projectId);
        data.project = { connect: { id: dto.projectId } };
      } else {
        data.project = { disconnect: true };
      }
    }
    if (dto.payload !== undefined) data.payload = this.cleanPayload(dto.payload) as Prisma.InputJsonValue;

    await this.prisma.issueTemplate.update({ where: { id }, data });
    return this.getTemplate(workspaceId, id);
  }

  async removeTemplate(workspaceId: string, id: string, actingUserId: string): Promise<{ success: true }> {
    const cur = await this.getTemplate(workspaceId, id);
    if (cur.projectId) await this.assertProjectAdmin(actingUserId, workspaceId, cur.projectId);
    await this.prisma.issueTemplate.delete({ where: { id } });
    return { success: true };
  }

  /* ============================ Việc lặp lại ============================ */

  async listRecurring(workspaceId: string, projectId?: string): Promise<RecurringIssueDto[]> {
    const rows = await this.prisma.recurringIssue.findMany({
      where: {
        project: { workspaceId, deletedAt: null },
        ...(projectId && projectId !== SCOPE_SHARED ? { projectId } : {}),
      },
      orderBy: [{ active: 'desc' }, { nextRunAt: 'asc' }],
      include: { project: PROJECT_BRIEF },
    });
    return rows.map((r) => this.toRecurringDto(r));
  }

  async getRecurring(workspaceId: string, id: string): Promise<RecurringIssueDto> {
    const row = await this.prisma.recurringIssue.findFirst({
      where: { id, project: { workspaceId, deletedAt: null } },
      include: { project: PROJECT_BRIEF },
    });
    if (!row) throw new NotFoundAppException('Việc lặp lại');
    return this.toRecurringDto(row);
  }

  async createRecurring(workspaceId: string, dto: CreateRecurringInput, actingUserId: string): Promise<RecurringIssueDto> {
    const name = dto.name.trim();
    if (!name) throw new BusinessRuleException('Tên việc lặp lại bắt buộc');
    await this.requireProject(workspaceId, dto.projectId);
    await this.assertProjectAdmin(actingUserId, workspaceId, dto.projectId);

    const payload = this.cleanPayload(dto.payload);
    this.assertRunnable(payload);
    const cfg = this.configOf({ freq: dto.freq, interval: dto.interval, weekday: dto.weekday ?? null, monthDay: dto.monthDay ?? null, hour: dto.hour });

    const created = await this.prisma.recurringIssue.create({
      data: {
        projectId: dto.projectId,
        name,
        freq: cfg.freq,
        interval: cfg.interval,
        weekday: cfg.freq === 'WEEKLY' ? cfg.weekday : null,
        monthDay: cfg.freq === 'MONTHLY' ? cfg.monthDay : null,
        hour: cfg.hour,
        payload: payload as Prisma.InputJsonValue,
        active: dto.active ?? true,
        nextRunAt: computeNextRun(cfg),
        createdById: actingUserId,
      },
      select: { id: true },
    });
    return this.getRecurring(workspaceId, created.id);
  }

  async updateRecurring(workspaceId: string, id: string, dto: UpdateRecurringInput, actingUserId: string): Promise<RecurringIssueDto> {
    const cur = await this.getRecurring(workspaceId, id);
    await this.assertProjectAdmin(actingUserId, workspaceId, cur.projectId);
    const data: Prisma.RecurringIssueUpdateInput = {};

    if (dto.name !== undefined) {
      const name = (dto.name ?? '').trim();
      if (!name) throw new BusinessRuleException('Tên việc lặp lại bắt buộc');
      data.name = name;
    }
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.payload !== undefined) {
      const payload = this.cleanPayload(dto.payload);
      this.assertRunnable(payload);
      data.payload = payload as Prisma.InputJsonValue;
    }

    // Đổi bất kỳ tham số lịch nào → tính lại mốc chạy kế tiếp.
    const scheduleTouched =
      dto.freq !== undefined || dto.interval !== undefined || dto.weekday !== undefined ||
      dto.monthDay !== undefined || dto.hour !== undefined;
    if (scheduleTouched) {
      const cfg = this.configOf({
        freq: dto.freq ?? cur.freq,
        interval: dto.interval ?? cur.interval,
        weekday: dto.weekday === undefined ? cur.weekday : dto.weekday,
        monthDay: dto.monthDay === undefined ? cur.monthDay : dto.monthDay,
        hour: dto.hour ?? cur.hour,
      });
      data.freq = cfg.freq;
      data.interval = cfg.interval;
      data.weekday = cfg.freq === 'WEEKLY' ? cfg.weekday : null;
      data.monthDay = cfg.freq === 'MONTHLY' ? cfg.monthDay : null;
      data.hour = cfg.hour;
      data.nextRunAt = computeNextRun(cfg);
    }

    await this.prisma.recurringIssue.update({ where: { id }, data });
    return this.getRecurring(workspaceId, id);
  }

  async removeRecurring(workspaceId: string, id: string, actingUserId: string): Promise<{ success: true }> {
    const cur = await this.getRecurring(workspaceId, id);
    await this.assertProjectAdmin(actingUserId, workspaceId, cur.projectId);
    await this.prisma.recurringIssue.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Chạy ngay theo yêu cầu người dùng: tạo issue lập tức, ghi `lastRunAt`,
   * KHÔNG dời `nextRunAt` (lịch định kỳ giữ nguyên).
   */
  async runNow(workspaceId: string, id: string, actingUserId: string) {
    const rec = await this.prisma.recurringIssue.findFirst({
      where: { id, project: { workspaceId, deletedAt: null } },
      include: { project: { select: { id: true, workspaceId: true, leadId: true } } },
    });
    if (!rec) throw new NotFoundAppException('Việc lặp lại');
    await this.assertProjectAdmin(actingUserId, workspaceId, rec.projectId);

    const payload = this.parsePayload(rec.payload);
    this.assertRunnable(payload);
    const issue = await this.createIssueFrom(rec.project.workspaceId, rec.projectId, actingUserId, rec.name, payload);
    await this.prisma.recurringIssue.update({ where: { id }, data: { lastRunAt: new Date() } });
    return { success: true, issue };
  }

  /* ================================ Cron ================================ */

  /**
   * Mỗi 15 phút: quét việc lặp lại đang bật đã tới hạn → sinh issue.
   * Mỗi bản ghi bọc try/catch riêng; `nextRunAt` luôn được dời tới mốc kế tiếp
   * (kể cả khi tạo issue lỗi) để không quét lặp vô hạn mỗi 15 phút.
   */
  @Cron(EVERY_15_MINUTES)
  async runDueRecurring(): Promise<void> {
    const now = new Date();
    let due: Array<{
      id: string;
      projectId: string;
      name: string;
      freq: string;
      interval: number;
      weekday: number | null;
      monthDay: number | null;
      hour: number;
      payload: Prisma.JsonValue;
      createdById: string | null;
      project: { workspaceId: string; leadId: string | null; deletedAt: Date | null };
    }>;
    try {
      due = await this.prisma.recurringIssue.findMany({
        where: { active: true, nextRunAt: { lte: now } },
        take: 200,
        select: {
          id: true, projectId: true, name: true, freq: true, interval: true, weekday: true,
          monthDay: true, hour: true, payload: true, createdById: true,
          project: { select: { workspaceId: true, leadId: true, deletedAt: true } },
        },
      });
    } catch (err) {
      this.warn('cron.load', err);
      return;
    }

    for (const rec of due) {
      const cfg = this.configOf({
        freq: rec.freq as Freq, interval: rec.interval, weekday: rec.weekday,
        monthDay: rec.monthDay, hour: rec.hour,
      });
      let ranOk = false;
      try {
        if (rec.project.deletedAt) {
          // Dự án đã xoá → tắt hẳn thay vì quét lại mỗi vòng.
          await this.prisma.recurringIssue.update({ where: { id: rec.id }, data: { active: false } });
          continue;
        }
        const payload = this.parsePayload(rec.payload);
        this.assertRunnable(payload);
        const actorId = await this.resolveActor(rec.createdById, rec.project.workspaceId, rec.project.leadId);
        if (!actorId) throw new Error('Không xác định được người tạo công việc — hãy thêm ít nhất một thành viên vào không gian làm việc');
        await this.createIssueFrom(rec.project.workspaceId, rec.projectId, actorId, rec.name, payload);
        ranOk = true;
      } catch (err) {
        this.warn(`cron.recurring:${rec.id}`, err);
      }
      try {
        await this.prisma.recurringIssue.update({
          where: { id: rec.id },
          data: { nextRunAt: nextRunAfterRun(cfg), ...(ranOk ? { lastRunAt: new Date() } : {}) },
        });
      } catch (err) {
        this.warn(`cron.reschedule:${rec.id}`, err);
      }
    }
  }

  /* =============================== Helpers =============================== */

  private templateScope(projectId?: string): Prisma.IssueTemplateWhereInput {
    if (!projectId) return {};
    if (projectId === SCOPE_SHARED) return { projectId: null };
    return { OR: [{ projectId }, { projectId: null }] };
  }

  /**
   * Guard route chỉ đọc `projectId` từ params/body/query nên với các thao tác trên bản ghi
   * đã có, ta kiểm tra lại quyền theo DỰ ÁN THẬT của bản ghi — chặn việc mượn `?projectId`
   * của dự án khác để leo quyền.
   */
  private async assertProjectAdmin(userId: string, workspaceId: string, projectId: string): Promise<void> {
    const perms = await this.rbac.getEffectivePermissions(userId, workspaceId, projectId);
    if (perms.has(PERMISSIONS.PROJECT_ADMIN) || perms.has(PERMISSIONS.WORKSPACE_ADMIN)) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } });
    if (u?.isSystemAdmin) return;
    throw new ForbiddenAppException('Cần quyền quản trị dự án cho dự án này');
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p;
  }

  private configOf(input: {
    freq: Freq; interval?: number | null; weekday?: number | null; monthDay?: number | null; hour?: number | null;
  }): RecurrenceConfig {
    return {
      freq: input.freq,
      interval: Math.max(1, Math.trunc(input.interval ?? 1)),
      weekday: input.weekday ?? 1,
      monthDay: input.monthDay ?? 1,
      hour: Math.min(Math.max(Math.trunc(input.hour ?? 8), 0), 23),
    };
  }

  /** Bỏ các khoá rỗng/null để payload lưu gọn, tránh ghi đè bằng giá trị vô nghĩa. */
  private cleanPayload(raw: unknown): IssuePayload {
    const parsed = issuePayloadSchema.safeParse(raw ?? {});
    const p: IssuePayload = parsed.success ? parsed.data : {};
    const out: IssuePayload = {};
    if (p.typeId) out.typeId = p.typeId;
    if (p.priorityId) out.priorityId = p.priorityId;
    if (p.summary && p.summary.trim()) out.summary = p.summary.trim();
    if (p.description && p.description.trim()) out.description = p.description;
    if (p.assigneeId) out.assigneeId = p.assigneeId;
    if (p.labelIds?.length) out.labelIds = p.labelIds;
    if (typeof p.storyPoints === 'number') out.storyPoints = p.storyPoints;
    return out;
  }

  private parsePayload(raw: Prisma.JsonValue): IssuePayload {
    return this.cleanPayload(raw);
  }

  private assertRunnable(payload: IssuePayload): void {
    if (!payload.typeId) throw new BusinessRuleException('Hãy chọn loại công việc mặc định cho việc lặp lại');
  }

  /** Người "tạo" issue tự động: người lập lịch → trưởng dự án → thành viên workspace bất kỳ. */
  private async resolveActor(createdById: string | null, workspaceId: string, leadId: string | null): Promise<string | null> {
    for (const candidate of [createdById, leadId]) {
      if (!candidate) continue;
      const ok = await this.prisma.workspaceMembership.findFirst({
        where: { workspaceId, userId: candidate },
        select: { userId: true },
      });
      if (ok) return ok.userId;
    }
    const any = await this.prisma.workspaceMembership.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    return any?.userId ?? null;
  }

  private async createIssueFrom(
    workspaceId: string,
    projectId: string,
    actorId: string,
    fallbackSummary: string,
    payload: IssuePayload,
  ) {
    const summary = this.applyTokens(payload.summary || fallbackSummary, new Date()).slice(0, 255);
    return this.issues.create(workspaceId, actorId, {
      projectId,
      typeId: payload.typeId!,
      summary,
      description: payload.description ? this.applyTokens(payload.description, new Date()) : null,
      descriptionFormat: 'MARKDOWN',
      priorityId: payload.priorityId ?? null,
      assigneeId: payload.assigneeId ?? null,
      labelIds: payload.labelIds ?? [],
      storyPoints: payload.storyPoints ?? null,
    });
  }

  /** Thay biến ngày trong tiêu đề/mô tả: {{ngay}}/{{date}} → 24/07/2026, {{thang}}/{{month}} → 07/2026. */
  private applyTokens(text: string, now: Date): string {
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    return text
      .replace(/\{\{\s*(ngay|date)\s*\}\}/gi, `${dd}/${mm}/${yyyy}`)
      .replace(/\{\{\s*(thang|month)\s*\}\}/gi, `${mm}/${yyyy}`);
  }

  private warn(scope: string, err: unknown): void {
    this.logger.warn(`[automation] ${scope}: ${err instanceof Error ? err.message : String(err)}`);
  }

  private toTemplateDto(r: TemplateRow): IssueTemplateDto {
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      projectId: r.projectId,
      project: r.project,
      name: r.name,
      description: r.description,
      payload: this.parsePayload(r.payload),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toRecurringDto(r: RecurringRow): RecurringIssueDto {
    return {
      id: r.id,
      projectId: r.projectId,
      project: r.project,
      name: r.name,
      freq: r.freq as Freq,
      interval: r.interval,
      weekday: r.weekday,
      monthDay: r.monthDay,
      hour: r.hour,
      payload: this.parsePayload(r.payload),
      active: r.active,
      nextRunAt: r.nextRunAt.toISOString(),
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
