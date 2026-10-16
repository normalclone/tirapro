import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
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
import { RedisService } from '../../infra/redis/redis.service';
import { withCronLock } from '../../common/cron-lock';
import { LIVE_PROJECT } from '../../common/live-project';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { IntegrationsService } from '../integrations/integrations.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { TELEGRAM_TOKEN_UNUSABLE_MESSAGE, TelegramService } from '../integrations/telegram.service';

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

/** Tích hợp đang ERROR (token vẫn dùng được): digest không gửi cho tới khi "Gửi thử" phục hồi. */
const INTEGRATION_ERROR_MESSAGE = 'Tích hợp đang ở trạng thái Lỗi — bấm Gửi thử để kiểm tra lại';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** Cửa sổ chống gửi đôi cho cron: bằng TTL khoá cron (1800s). */
const DIGEST_DEDUPE_MS = 30 * 60 * 1000;

@Injectable()
export class DigestsService implements OnApplicationShutdown {
  private readonly logger = new Logger(DigestsService.name);
  /** Bật khi app tắt: vòng gửi digest dừng sớm. */
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly redis: RedisService,
    private readonly integrations: IntegrationsService,
    private readonly access: ProjectAccessService,
  ) {}

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  // ------------------------------- CRUD -------------------------------

  /**
   * Liệt kê subscription của workspace (lọc theo project nếu có). `viewerId` bắt buộc: báo cáo gắn dự án riêng tư
   * người xem không thấy bị loại (tên/lịch/số liệu chọn của dự án ẩn không lộ); báo cáo cấp workspace luôn hiện.
   */
  async list(workspaceId: string, projectId: string | undefined, viewerId: string) {
    const ids = await this.access.visibleProjectIds(viewerId, workspaceId);
    return this.prisma.reportSubscription.findMany({
      where: {
        workspaceId,
        ...(projectId ? { projectId } : {}),
        ...(ids === null ? {} : { OR: [{ projectId: null }, { projectId: { in: ids } }] }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Tạo subscription mới. */
  async create(workspaceId: string, userId: string, input: CreateDigestInput) {
    // Báo cáo gắn dự án: người tạo phải THẤY dự án (dự án riêng tư người ngoài → 404, không tạo, không lộ sự tồn tại).
    if (input.projectId) await this.access.assertCanSee(userId, workspaceId, input.projectId);
    // `!== undefined` (không phải truthy): chuỗi rỗng cũng phải bị từ chối, không được lưu như một channelId.
    if (input.channelId !== undefined)
      await this.assertChannelInWorkspace(workspaceId, input.channelId);
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
  async update(workspaceId: string, id: string, input: UpdateDigestInput, viewerId: string) {
    await this.requireSubscription(workspaceId, id, viewerId);
    // null = gỡ kênh (không cần kiểm).
    if (input.channelId !== undefined && input.channelId !== null) {
      await this.assertChannelInWorkspace(workspaceId, input.channelId);
    }
    const data: Prisma.ReportSubscriptionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.schedule !== undefined) data.schedule = input.schedule;
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
    if (input.channelId !== undefined) data.channelId = input.channelId;
    if (input.metrics !== undefined) data.metrics = input.metrics;
    return this.prisma.reportSubscription.update({ where: { id }, data });
  }

  /** Xóa subscription. */
  async remove(workspaceId: string, id: string, viewerId: string): Promise<{ success: true }> {
    await this.requireSubscription(workspaceId, id, viewerId);
    await this.prisma.reportSubscription.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Chạy ngay một subscription: tính toán + gửi + cập nhật lastRunAt.
   * Chỉ ghi lastRunAt khi thật sự gửi được — `sent:false` không được làm cron bỏ qua sub trong cửa sổ dedupe.
   * Dữ liệu dự án riêng tư chỉ nằm trong báo cáo CẤP DỰ ÁN (người tạo đã phải thấy dự án). Báo cáo cấp workspace:
   * - gửi ra KÊNH (nhóm Telegram nhiều người — thành viên nhóm không đồng nghĩa thành viên dự án) → chỉ dự án CÔNG KHAI,
   *   giống cron;
   * - không có kênh (chỉ trả văn bản cho đúng người bấm) → lọc theo quyền xem của người đó.
   */
  async run(
    workspaceId: string,
    id: string,
    viewerId: string,
  ): Promise<{ sent: boolean; summaryText: string }> {
    const sub = await this.requireSubscription(workspaceId, id, viewerId);
    const scope = sub.projectId
      ? undefined
      : sub.channelId
        ? await this.publicProjectIds(workspaceId)
        : ((await this.access.visibleProjectIds(viewerId, workspaceId)) ?? undefined);
    const summaryText = await this.buildDigest(workspaceId, sub.projectId ?? undefined, scope);
    const { sent, tokenUnusable, integrationError } = await this.send(
      workspaceId,
      sub.channelId,
      summaryText,
    );
    if (tokenUnusable) throw new BusinessRuleException(TELEGRAM_TOKEN_UNUSABLE_MESSAGE);
    if (integrationError) throw new BusinessRuleException(INTEGRATION_ERROR_MESSAGE);
    if (sent) {
      await this.prisma.reportSubscription.update({
        where: { id },
        data: { lastRunAt: new Date() },
      });
    }
    return { sent, summaryText };
  }

  // ----------------------------- Compute ------------------------------

  /**
   * Tổng hợp digest dạng text/HTML tiếng Việt (Telegram parse_mode HTML) cho 7 ngày gần nhất.
   * Mỗi truy vấn độc lập, lỗi cục bộ không làm hỏng toàn bộ (degrade-graceful).
   * `scopeProjectIds`: chỉ tính các dự án này khi không có `projectId` (undefined = mọi dự án — chỉ dùng khi người gọi
   * thấy tất cả và văn bản không đi ra kênh chung; cron/kênh luôn truyền danh sách dự án công khai).
   */
  async buildDigest(
    workspaceId: string,
    projectId?: string,
    scopeProjectIds?: string[],
  ): Promise<string> {
    const since = new Date(Date.now() - SEVEN_DAYS_MS);
    const only = projectFilter(projectId, scopeProjectIds);
    const issueScope: Prisma.IssueWhereInput = {
      workspaceId,
      deletedAt: null,
      ...LIVE_PROJECT, // dự án đã xoá mềm không được lọt vào số liệu gửi ra ngoài
      ...only,
    };

    const [created, resolved, openByCategory, sprintLine] = await Promise.all([
      this.countCreated(issueScope, since),
      this.countResolved(workspaceId, only, since),
      this.openCountByCategory(issueScope),
      this.activeSprintLine(workspaceId, only),
    ]);

    const openTotal = openByCategory.todo + openByCategory.inProgress;
    const lines = [
      '📊 <b>Tổng kết tuần</b>',
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
        where: { ...scope, deletedAt: null, createdAt: { gte: since } },
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
    only: { projectId?: string | { in: string[] } },
    since: Date,
  ): Promise<number> {
    try {
      const rows = await this.prisma.issueHistory.findMany({
        where: {
          field: HistoryField.STATUS,
          newCategory: StatusCategory.DONE,
          occurredAt: { gte: since },
          issue: {
            workspaceId,
            deletedAt: null,
            ...LIVE_PROJECT,
            ...only,
          },
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
        where: { ...scope, deletedAt: null, status: { category: { not: StatusCategory.DONE } } },
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
    only: { projectId?: string | { in: string[] } },
  ): Promise<string | null> {
    try {
      const sprint = await this.prisma.sprint.findFirst({
        where: {
          state: SprintState.ACTIVE,
          deletedAt: null,
          project: { workspaceId, deletedAt: null },
          ...only,
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
   * - Token riêng của tích hợp không giải mã được → sent=false, tokenUnusable=true (KHÔNG rơi về bot toàn cục).
   * - Tích hợp đang ERROR nhưng token dùng được → sent=false, integrationError=true (chờ "Gửi thử" phục hồi).
   * Kênh phải thuộc `workspaceId` (không gửi qua kênh của workspace khác).
   */
  private async send(
    workspaceId: string,
    channelId: string | null,
    text: string,
  ): Promise<{ sent: boolean; tokenUnusable: boolean; integrationError: boolean }> {
    const notSent = { sent: false, tokenUnusable: false, integrationError: false };
    if (!channelId) return notSent;
    try {
      const channel = await this.prisma.integrationChannel.findFirst({
        where: { id: channelId, workspaceId, isEnabled: true },
        include: { integration: true },
      });
      if (!channel) return notSent;
      const integration = channel.integration;
      // ERROR vẫn phải qua resolveBotToken: token còn hỏng thì "Chạy ngay" phải báo 422 chứ không im lặng.
      if (
        integration.type !== IntegrationType.TELEGRAM ||
        (integration.status !== IntegrationStatus.ACTIVE &&
          integration.status !== IntegrationStatus.ERROR)
      ) {
        return notSent;
      }
      const res = this.telegram.resolveBotToken(integration.config);
      if (res.kind === 'unusable') {
        await this.integrations.reportUnusableToken(integration.id);
        return { sent: false, tokenUnusable: true, integrationError: false };
      }
      // Token ổn nhưng tích hợp chưa phục hồi (Gửi thử).
      if (integration.status === IntegrationStatus.ERROR) {
        return { sent: false, tokenUnusable: false, integrationError: true };
      }
      const sent = await this.telegram.send(
        res.kind === 'own' ? res.token : null,
        channel.externalId,
        text,
      );
      return { sent, tokenUnusable: false, integrationError: false };
    } catch (err) {
      this.warn('send', err);
      return notSent;
    }
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
    // Khoá Redis để nhiều node API không gửi trùng digest.
    await withCronLock(this.redis, 'digests:scheduled', 1800, () => this.sendScheduled()).catch(
      (err) => this.warn('runScheduled.lock', err),
    );
  }

  private async sendScheduled(): Promise<void> {
    if (this.stopping) return;
    const isMonday = new Date().getDay() === 1;
    let subs: Array<{
      id: string;
      workspaceId: string;
      projectId: string | null;
      channelId: string | null;
      schedule: DigestSchedule;
      lastRunAt: Date | null;
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
          lastRunAt: true,
        },
      });
    } catch (err) {
      this.warn('runScheduled.load', err);
      return;
    }

    const publicScopes = new Map<string, Promise<string[]>>();
    for (const sub of subs) {
      if (this.stopping) break; // app đang tắt
      const now = new Date();
      // Node khác vừa gửi (đồng hồ lệch nên khoá cron đã nhả trước khi cron node này chạy).
      if (sub.lastRunAt && now.getTime() - sub.lastRunAt.getTime() < DIGEST_DEDUPE_MS) continue;
      try {
        // Compare-and-set: chỉ một node thắng; node thua thấy count 0.
        const claimed = await this.prisma.reportSubscription.updateMany({
          where: { id: sub.id, lastRunAt: sub.lastRunAt },
          data: { lastRunAt: now },
        });
        if (claimed.count === 0) continue;
        try {
          // Cấp workspace gửi ra kênh chung ⇒ chỉ dự án công khai; cấp dự án ⇒ đúng dự án admin đã chủ ý gắn.
          const scope = sub.projectId
            ? undefined
            : await this.publicProjectIdsCached(publicScopes, sub.workspaceId);
          const text = await this.buildDigest(sub.workspaceId, sub.projectId ?? undefined, scope);
          await this.send(sub.workspaceId, sub.channelId, text);
        } catch (err) {
          // Chỉ là lưới an toàn cho lỗi BẤT NGỜ (vd buildDigest ném). send()/telegram.send tự nuốt lỗi
          // gửi nên lỗi mạng KHÔNG đi vào đây => không retry trong ngày (hành vi cũ). Cơ chế là at-most-once:
          // node chết sau khi claim thì digest ngày đó mất.
          await this.prisma.reportSubscription
            .updateMany({
              where: { id: sub.id, lastRunAt: now },
              data: { lastRunAt: sub.lastRunAt },
            })
            .catch(() => undefined);
          throw err;
        }
      } catch (err) {
        this.warn(`runScheduled.sub:${sub.id}`, err);
      }
    }
  }

  // ----------------------------- Helpers ------------------------------

  /**
   * Id các dự án CÔNG KHAI còn sống của workspace — phạm vi duy nhất của digest cấp workspace gửi ra kênh chung.
   * Ngữ cảnh hệ thống/kênh chung không có người xem cụ thể nên không dùng visibleWhere.
   */
  private async publicProjectIds(workspaceId: string): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null, isPrivate: false },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private publicProjectIdsCached(
    cache: Map<string, Promise<string[]>>,
    workspaceId: string,
  ): Promise<string[]> {
    let hit = cache.get(workspaceId);
    if (!hit) {
      hit = this.publicProjectIds(workspaceId);
      cache.set(workspaceId, hit);
    }
    return hit;
  }

  /** Kênh phải thuộc workspace của người gọi — chặn trỏ digest vào kênh Telegram của workspace khác. */
  private async assertChannelInWorkspace(workspaceId: string, channelId: string): Promise<void> {
    const channel = await this.prisma.integrationChannel.findFirst({
      where: { id: channelId, workspaceId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundAppException('Kênh thông báo');
  }

  /** Báo cáo gắn dự án riêng tư người gọi không thấy = không tồn tại (404 như id sai). */
  private async requireSubscription(workspaceId: string, id: string, viewerId: string) {
    const row = await this.prisma.reportSubscription.findFirst({
      where: { id, workspaceId },
    });
    if (!row) throw new NotFoundAppException('Báo cáo định kỳ');
    if (row.projectId)
      await this.access.assertCanSee(viewerId, workspaceId, row.projectId, 'Báo cáo định kỳ');
    return row;
  }

  private warn(context: string, err: unknown): void {
    this.logger.warn(
      `Digest (${context}) lỗi: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Điều kiện `projectId` của Issue/Sprint: một dự án, hoặc tập dự án được phép, hoặc không giới hạn. */
function projectFilter(
  projectId: string | undefined,
  scopeProjectIds: string[] | undefined,
): { projectId?: string | { in: string[] } } {
  if (projectId) return { projectId };
  if (scopeProjectIds) return { projectId: { in: scopeProjectIds } };
  return {};
}

/** Escape ký tự HTML để gửi an toàn với parse_mode HTML của Telegram. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
