import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DigestSchedule,
  HistoryField,
  IntegrationStatus,
  IntegrationType,
  Prisma,
  SprintState,
  StatusCategory,
} from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { TelegramService } from '../integrations/telegram.service';

/** Input tạo mới subscription (đã validate qua zod ở controller). */
export interface CreateDigestInput {
  name: string;
  schedule?: DigestSchedule;
  projectId?: string;
  channelId?: string;
  metrics?: string[];
  recipients?: string[];
}

/** Input cập nhật subscription (partial). */
export interface UpdateDigestInput {
  name?: string;
  schedule?: DigestSchedule;
  isEnabled?: boolean;
  channelId?: string | null;
  metrics?: string[];
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class DigestsService {
  private readonly logger = new Logger(DigestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  // ------------------------------- CRUD -------------------------------

  /** Liệt kê subscription của workspace (lọc theo project nếu có). */
  async list(workspaceId: string, projectId?: string) {
    return this.prisma.reportSubscription.findMany({
      where: { workspaceId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Tạo subscription mới. */
  async create(workspaceId: string, userId: string, input: CreateDigestInput) {
    return this.prisma.reportSubscription.create({
      data: {
        workspaceId,
        name: input.name,
        schedule: input.schedule ?? DigestSchedule.WEEKLY,
        projectId: input.projectId ?? null,
        channelId: input.channelId ?? null,
        metrics: input.metrics ?? [],
        recipients: input.recipients ?? [],
        createdById: userId,
      },
    });
  }

  /** Cập nhật subscription (name/schedule/isEnabled/channelId/metrics). */
  async update(workspaceId: string, id: string, input: UpdateDigestInput) {
    await this.requireSubscription(workspaceId, id);
    const data: Prisma.ReportSubscriptionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.schedule !== undefined) data.schedule = input.schedule;
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
    if (input.channelId !== undefined) data.channelId = input.channelId;
    if (input.metrics !== undefined) data.metrics = input.metrics;
    return this.prisma.reportSubscription.update({ where: { id }, data });
  }

  /** Xóa subscription. */
  async remove(workspaceId: string, id: string): Promise<{ success: true }> {
    await this.requireSubscription(workspaceId, id);
    await this.prisma.reportSubscription.delete({ where: { id } });
    return { success: true };
  }

  /** Chạy ngay một subscription: tính toán + gửi + cập nhật lastRunAt. */
  async run(workspaceId: string, id: string): Promise<{ sent: boolean; summaryText: string }> {
    const sub = await this.requireSubscription(workspaceId, id);
    const summaryText = await this.buildDigest(workspaceId, sub.projectId ?? undefined);
    const sent = await this.send(sub.channelId, summaryText);
    await this.prisma.reportSubscription.update({
      where: { id },
      data: { lastRunAt: new Date() },
    });
    return { sent, summaryText };
  }

  // ----------------------------- Compute ------------------------------

  /**
   * Tổng hợp digest dạng text/HTML tiếng Việt (Telegram parse_mode HTML) cho 7 ngày gần nhất.
   * Mỗi truy vấn độc lập, lỗi cục bộ không làm hỏng toàn bộ (degrade-graceful).
   */
  async buildDigest(workspaceId: string, projectId?: string): Promise<string> {
    const since = new Date(Date.now() - SEVEN_DAYS_MS);
    const issueScope: Prisma.IssueWhereInput = {
      workspaceId,
      deletedAt: null,
      ...(projectId ? { projectId } : {}),
    };

    const [created, resolved, openByCategory, sprintLine] = await Promise.all([
      this.countCreated(issueScope, since),
      this.countResolved(workspaceId, projectId, since),
      this.openCountByCategory(issueScope),
      this.activeSprintLine(workspaceId, projectId),
    ]);

    const openTotal = openByCategory.todo + openByCategory.inProgress;
    const lines = [
      '📊 <b>Digest tuần</b>',
      `• Tạo mới (7 ngày): ${created}`,
      `• Đã xong (7 ngày): ${resolved}`,
      `• Đang mở: ${openTotal} (Cần làm: ${openByCategory.todo} · Đang làm: ${openByCategory.inProgress})`,
    ];
    if (sprintLine) lines.push(sprintLine);
    return lines.join('\n');
  }

  /** Số issue tạo mới trong 7 ngày. */
  private async countCreated(scope: Prisma.IssueWhereInput, since: Date): Promise<number> {
    try {
      return await this.prisma.issue.count({
        where: { ...scope, createdAt: { gte: since } },
      });
    } catch (err) {
      this.warn('countCreated', err);
      return 0;
    }
  }

  /**
   * Số issue chuyển sang category DONE trong 7 ngày (qua IssueHistory field STATUS).
   * Đếm số issue riêng biệt để tránh đếm trùng khi 1 issue đổi trạng thái nhiều lần.
   */
  private async countResolved(
    workspaceId: string,
    projectId: string | undefined,
    since: Date,
  ): Promise<number> {
    try {
      const rows = await this.prisma.issueHistory.findMany({
        where: {
          field: HistoryField.STATUS,
          newCategory: StatusCategory.DONE,
          occurredAt: { gte: since },
          issue: { workspaceId, deletedAt: null, ...(projectId ? { projectId } : {}) },
        },
        select: { issueId: true },
        distinct: ['issueId'],
      });
      return rows.length;
    } catch (err) {
      this.warn('countResolved', err);
      return 0;
    }
  }

  /** Đếm issue đang mở (chưa Done) theo category TODO / IN_PROGRESS. */
  private async openCountByCategory(
    scope: Prisma.IssueWhereInput,
  ): Promise<{ todo: number; inProgress: number }> {
    try {
      const grouped = await this.prisma.issue.groupBy({
        by: ['statusId'],
        where: { ...scope, status: { category: { not: StatusCategory.DONE } } },
        _count: { _all: true },
      });
      if (grouped.length === 0) return { todo: 0, inProgress: 0 };
      const statuses = await this.prisma.status.findMany({
        where: { id: { in: grouped.map((g) => g.statusId) } },
        select: { id: true, category: true },
      });
      const categoryById = new Map(statuses.map((s) => [s.id, s.category]));
      let todo = 0;
      let inProgress = 0;
      for (const g of grouped) {
        const category = categoryById.get(g.statusId);
        const n = g._count._all;
        if (category === StatusCategory.IN_PROGRESS) inProgress += n;
        else todo += n; // TODO (và mọi category còn lại không phải DONE)
      }
      return { todo, inProgress };
    } catch (err) {
      this.warn('openCountByCategory', err);
      return { todo: 0, inProgress: 0 };
    }
  }

  /** Dòng tóm tắt sprint đang ACTIVE + tổng điểm còn lại (nếu có). */
  private async activeSprintLine(
    workspaceId: string,
    projectId: string | undefined,
  ): Promise<string | null> {
    try {
      const sprint = await this.prisma.sprint.findFirst({
        where: {
          state: SprintState.ACTIVE,
          deletedAt: null,
          project: { workspaceId },
          ...(projectId ? { projectId } : {}),
        },
        orderBy: { startDate: 'desc' },
        select: { id: true, name: true },
      });
      if (!sprint) return null;
      const remaining = await this.prisma.issue.aggregate({
        where: {
          sprintId: sprint.id,
          deletedAt: null,
          status: { category: { not: StatusCategory.DONE } },
        },
        _sum: { storyPoints: true },
      });
      const points = remaining._sum.storyPoints ?? 0;
      return `• Sprint: <b>${escapeHtml(sprint.name)}</b> · Điểm còn lại: ${points}`;
    } catch (err) {
      this.warn('activeSprintLine', err);
      return null;
    }
  }

  // ------------------------------- Send -------------------------------

  /**
   * Gửi digest qua Telegram nếu có channelId. Degrade-graceful:
   * - Không có channelId / không tìm thấy kênh / kênh tắt / token thiếu → sent=false, KHÔNG ném.
   */
  private async send(channelId: string | null, text: string): Promise<boolean> {
    if (!channelId) return false;
    try {
      const channel = await this.prisma.integrationChannel.findFirst({
        where: { id: channelId, isEnabled: true },
        include: { integration: true },
      });
      if (!channel) return false;
      const integration = channel.integration;
      if (
        integration.type !== IntegrationType.TELEGRAM ||
        integration.status !== IntegrationStatus.ACTIVE
      ) {
        return false;
      }
      const token = this.resolveToken(integration.config);
      return await this.telegram.send(token, channel.externalId, text);
    } catch (err) {
      this.warn('send', err);
      return false;
    }
  }

  /** Giải mã botToken từ Integration.config; null → dùng token toàn cục. */
  private resolveToken(config: Prisma.JsonValue): string | null {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const botToken = (config as Record<string, unknown>).botToken;
      if (typeof botToken === 'string' && botToken.length > 0) {
        return this.telegram.decrypt(botToken);
      }
    }
    return null;
  }

  // ------------------------------- Cron -------------------------------

  /**
   * Chạy định kỳ mỗi ngày 8h sáng. Gửi các subscription đang bật & đến hạn hôm nay:
   * - DAILY: luôn chạy.
   * - WEEKLY: chỉ thứ Hai (getDay()===1).
   * - SPRINT_END / MANUAL: bỏ qua ở cron (chạy thủ công hoặc theo sự kiện khác).
   * Mỗi subscription bọc try/catch riêng — không bao giờ ném ra ngoài cron.
   * An toàn khi không có subscription nào (no-op).
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async runScheduled(): Promise<void> {
    const isMonday = new Date().getDay() === 1;
    let subs: Array<{
      id: string;
      workspaceId: string;
      projectId: string | null;
      channelId: string | null;
      schedule: DigestSchedule;
    }>;
    try {
      subs = await this.prisma.reportSubscription.findMany({
        where: {
          isEnabled: true,
          schedule: isMonday
            ? { in: [DigestSchedule.DAILY, DigestSchedule.WEEKLY] }
            : DigestSchedule.DAILY,
        },
        select: {
          id: true,
          workspaceId: true,
          projectId: true,
          channelId: true,
          schedule: true,
        },
      });
    } catch (err) {
      this.warn('runScheduled.load', err);
      return;
    }

    for (const sub of subs) {
      try {
        const text = await this.buildDigest(sub.workspaceId, sub.projectId ?? undefined);
        await this.send(sub.channelId, text);
        await this.prisma.reportSubscription.update({
          where: { id: sub.id },
          data: { lastRunAt: new Date() },
        });
      } catch (err) {
        this.warn(`runScheduled.sub:${sub.id}`, err);
      }
    }
  }

  // ----------------------------- Helpers ------------------------------

  private async requireSubscription(workspaceId: string, id: string) {
    const row = await this.prisma.reportSubscription.findFirst({
      where: { id, workspaceId },
    });
    if (!row) throw new NotFoundAppException('Báo cáo định kỳ');
    return row;
  }

  private warn(context: string, err: unknown): void {
    this.logger.warn(`Digest (${context}) lỗi: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Escape ký tự HTML để gửi an toàn với parse_mode HTML của Telegram. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
