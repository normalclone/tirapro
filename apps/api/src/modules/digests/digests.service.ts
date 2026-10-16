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
import {
  type DigestBlockId,
  type DigestModel,
  type DigestSection,
  resolveDigestBlocks,
  vnTodayUtc,
  WORKSPACE_ONLY_DIGEST_BLOCKS,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { withCronLock } from '../../common/cron-lock';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { IntegrationsService } from '../integrations/integrations.service';
import { TELEGRAM_TOKEN_UNUSABLE_MESSAGE, TelegramService } from '../integrations/telegram.service';
import { LeadershipService } from '../analytics/leadership.service';
import { ProjectHealthService } from '../analytics/project-health.service';
import { ProjectAccessService, PUBLIC_VIEWER } from '../rbac/project-access.service';
import { renderPlainText, renderTelegramHtml } from './digest-render';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
/** Số dòng tối đa mỗi khối "danh sách" (việc trễ, rủi ro, OKR, người quá tải, dự án). */
const TOP_N = 3;
const LIST_N = 5;
const HEALTH_N = 10;
const LEADERSHIP_CARD_OF: Partial<Record<DigestBlockId, 'topRisks' | 'slowGoals' | 'overloaded'>> =
  {
    risks: 'topRisks',
    okr: 'slowGoals',
    workload: 'overloaded',
  };
/** Cửa sổ chống gửi đôi cho cron: bằng TTL khoá cron (1800s). */
const DIGEST_DEDUPE_MS = 30 * 60 * 1000;

/** Ngữ cảnh dùng chung của các khối trong MỘT lượt dựng digest. */
interface BlockContext {
  workspaceId: string;
  projectId: string | undefined;
  viewerId: string;
  now: Date;
  /** `visibleWhere` của người xem — lồng vào `project: {...}`. */
  visible: Prisma.ProjectWhereInput;
  /** Điều kiện Issue đã gồm workspace + dự án sống + dự án người xem thấy (+ projectId nếu có). */
  issueScope: Prisma.IssueWhereInput;
  /** Các thẻ lãnh đạo cần tải (chỉ ba khối risks/okr/workload) + lời hứa kết quả dùng chung. */
  cards?: readonly ('topRisks' | 'slowGoals' | 'overloaded')[];
  leadership: Promise<Awaited<ReturnType<LeadershipService['get']>>> | undefined;
}

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
    private readonly leadership: LeadershipService,
    private readonly health: ProjectHealthService,
  ) {}

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  // ------------------------------- CRUD -------------------------------

  /** Liệt kê subscription của workspace (lọc theo project nếu có). */
  async list(workspaceId: string, viewerId: string, projectId?: string) {
    // Digest gắn dự án riêng tư người xem không thấy → không liệt kê (tên digest có thể lộ tên dự án).
    const visibleIds = await this.access.visibleProjectIds(viewerId, workspaceId);
    return this.prisma.reportSubscription.findMany({
      where: {
        workspaceId,
        ...(projectId ? { projectId } : {}),
        ...(visibleIds ? { OR: [{ projectId: null }, { projectId: { in: visibleIds } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Tạo subscription mới. */
  async create(workspaceId: string, userId: string, input: CreateDigestInput) {
    if (input.projectId) {
      await this.access.assertCanSee(userId, workspaceId, input.projectId, 'Dự án');
    }
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
  async update(workspaceId: string, id: string, input: UpdateDigestInput) {
    await this.requireSubscription(workspaceId, id);
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
  async remove(workspaceId: string, id: string): Promise<{ success: true }> {
    await this.requireSubscription(workspaceId, id);
    await this.prisma.reportSubscription.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Người xem dùng để dựng nội dung gửi vào KÊNH CHUNG (nhóm Telegram): digest gắn một dự án thì theo quyền người
   * tạo (đã chọn rõ dự án đó); digest toàn workspace chỉ có dữ liệu dự án CÔNG KHAI — nhóm chung có thể có người
   * không thấy dự án riêng tư, không được lộ qua digest dù người tạo là admin.
   */
  private sharedViewer(sub: { projectId: string | null; createdById: string | null }): string {
    return sub.projectId && sub.createdById ? sub.createdById : PUBLIC_VIEWER;
  }

  /**
   * Chạy ngay một subscription: tính toán + gửi + cập nhật lastRunAt.
   * Chỉ ghi lastRunAt khi thật sự gửi được — `sent:false` không được làm cron bỏ qua sub trong cửa sổ dedupe.
   * `summaryText` = văn bản thuần của bản gửi vào kênh chung (hiển thị ở giao diện).
   */
  async run(workspaceId: string, id: string): Promise<{ sent: boolean; summaryText: string }> {
    const sub = await this.requireSubscription(workspaceId, id);
    const model = await this.buildDigest(
      workspaceId,
      sub.projectId ?? undefined,
      sub.metrics,
      this.sharedViewer(sub),
    );
    const { sent, tokenUnusable, integrationError } = await this.send(
      workspaceId,
      sub.channelId,
      renderTelegramHtml(model),
    );
    if (tokenUnusable) throw new BusinessRuleException(TELEGRAM_TOKEN_UNUSABLE_MESSAGE);
    if (integrationError) throw new BusinessRuleException(INTEGRATION_ERROR_MESSAGE);
    if (sent) {
      await this.prisma.reportSubscription.update({
        where: { id },
        data: { lastRunAt: new Date() },
      });
    }
    return { sent, summaryText: renderPlainText(model) };
  }

  /** Xem trước (chưa lưu): nội dung theo quyền xem của CHÍNH người bấm. */
  async preview(
    workspaceId: string,
    viewerId: string,
    input: { projectId?: string; metrics?: string[] },
  ): Promise<{ summaryText: string }> {
    if (input.projectId) {
      await this.access.assertCanSee(viewerId, workspaceId, input.projectId, 'Dự án');
    }
    const model = await this.buildDigest(workspaceId, input.projectId, input.metrics, viewerId);
    return { summaryText: renderPlainText(model) };
  }

  // ----------------------------- Compute ------------------------------

  /**
   * Dựng mô hình digest có cấu trúc cho 7 ngày gần nhất, chỉ gồm các khối đã chọn (`blocks` rỗng = digest cũ:
   * Tổng kết + Sprint). `viewerId` quyết định dự án nào được xuất hiện: MỌI truy vấn (kể cả Tổng kết) lọc theo
   * `ProjectAccessService.visibleWhere` — digest không bao giờ liệt kê dự án riêng tư mà người xem không thấy.
   * Mỗi khối bọc try/catch riêng: một nguồn lỗi chỉ làm khối đó trống (degrade-graceful).
   */
  async buildDigest(
    workspaceId: string,
    projectId: string | undefined,
    blocks: readonly string[] | undefined,
    viewerId: string,
  ): Promise<DigestModel> {
    const now = new Date();
    const wanted = resolveDigestBlocks(blocks).filter(
      (b) => !(projectId && WORKSPACE_ONLY_DIGEST_BLOCKS.includes(b)),
    );
    const visible = await this.access.visibleWhere(viewerId, workspaceId);
    const project = projectId
      ? await this.prisma.project.findFirst({
          where: { id: projectId, workspaceId, deletedAt: null, ...visible },
          select: { name: true },
        })
      : null;
    const title = 'Tổng kết tuần';
    if (projectId && !project) {
      return {
        title,
        subtitle: '',
        sections: [
          {
            id: 'unavailable',
            title: 'Không có dữ liệu',
            lines: ['Dự án không còn tồn tại hoặc bạn không có quyền xem.'],
          },
        ],
      };
    }
    const ctx: BlockContext = {
      workspaceId,
      projectId,
      viewerId,
      now,
      visible,
      issueScope: {
        workspaceId,
        deletedAt: null,
        project: { deletedAt: null, ...visible }, // dự án đã xoá mềm / riêng tư người xem không thấy → không lọt vào số liệu
        ...(projectId ? { projectId } : {}),
      },
      cards: wanted.flatMap((b) => (LEADERSHIP_CARD_OF[b] ? [LEADERSHIP_CARD_OF[b]] : [])),
      leadership: undefined,
    };
    const sections = await Promise.all(wanted.map((b) => this.buildBlock(b, ctx)));
    return {
      title,
      subtitle: project ? `Dự án: ${project.name}` : '',
      sections: sections.filter((s): s is DigestSection => s !== null),
    };
  }

  private async buildBlock(block: DigestBlockId, ctx: BlockContext): Promise<DigestSection | null> {
    try {
      switch (block) {
        case 'summary':
          return await this.summarySection(ctx);
        case 'overdue':
          return await this.overdueSection(ctx);
        case 'sprint':
          return await this.sprintSection(ctx);
        case 'risks':
        case 'okr':
        case 'workload':
          return await this.leadershipSection(block, ctx);
        case 'health':
          return await this.healthSection(ctx);
      }
    } catch (err) {
      this.warn(`block:${block}`, err);
      return null;
    }
  }

  /** Tạo mới / đã xong (7 ngày) / đang mở theo nhóm trạng thái. */
  private async summarySection(ctx: BlockContext): Promise<DigestSection> {
    const since = new Date(ctx.now.getTime() - SEVEN_DAYS_MS);
    const [created, resolved, openByCategory] = await Promise.all([
      this.countCreated(ctx.issueScope, since),
      this.countResolved(ctx, since),
      this.openCountByCategory(ctx.issueScope),
    ]);
    const openTotal = openByCategory.todo + openByCategory.inProgress;
    return {
      id: 'summary',
      title: 'Tổng kết tuần',
      lines: [
        `Tạo mới (7 ngày): ${created}`,
        `Đã xong (7 ngày): ${resolved}`,
        `Đang mở: ${openTotal} (Cần làm: ${openByCategory.todo} · Đang làm: ${openByCategory.inProgress})`,
      ],
    };
  }

  /** Số việc chưa xong đã qua hạn (hạn < hôm nay theo ngày Việt Nam) + 3 việc trễ nhất. */
  private async overdueSection(ctx: BlockContext): Promise<DigestSection | null> {
    const today = vnTodayUtc(ctx.now);
    const where: Prisma.IssueWhereInput = {
      ...ctx.issueScope,
      deletedAt: null,
      dueDate: { lt: today },
      status: { category: { not: StatusCategory.DONE } },
    };
    const [total, worst] = await Promise.all([
      this.prisma.issue.count({ where }),
      this.prisma.issue.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { key: 'asc' }],
        take: TOP_N,
        select: { key: true, summary: true, dueDate: true },
      }),
    ]);
    if (total === 0)
      return { id: 'overdue', title: 'Việc quá hạn', lines: ['Không có việc quá hạn.'] };
    const lines = [`${total} việc quá hạn`];
    for (const i of worst) {
      const days = i.dueDate
        ? Math.max(1, Math.round((today.getTime() - i.dueDate.getTime()) / DAY_MS))
        : 0;
      lines.push(`${i.key} — ${i.summary} (trễ ${days} ngày)`);
    }
    return { id: 'overdue', title: 'Việc quá hạn', lines };
  }

  /** Sprint đang chạy (tối đa 3, mới bắt đầu trước): tên, điểm còn lại, số ngày còn lại. */
  private async sprintSection(ctx: BlockContext): Promise<DigestSection | null> {
    const sprints = await this.prisma.sprint.findMany({
      where: {
        state: SprintState.ACTIVE,
        deletedAt: null,
        project: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...ctx.visible,
          ...(ctx.projectId ? { id: ctx.projectId } : {}),
        },
      },
      orderBy: { startDate: 'desc' },
      take: TOP_N,
      select: { id: true, name: true, endDate: true, project: { select: { key: true } } },
    });
    if (sprints.length === 0) return null;
    const remaining = await this.prisma.issue.groupBy({
      by: ['sprintId'],
      where: {
        sprintId: { in: sprints.map((s) => s.id) },
        deletedAt: null,
        status: { category: { not: StatusCategory.DONE } },
      },
      _sum: { storyPoints: true },
    });
    const pointsOf = new Map(remaining.map((r) => [r.sprintId, r._sum.storyPoints ?? 0]));
    const today = vnTodayUtc(ctx.now);
    const lines = sprints.map((s) => {
      const parts = [`${s.name}`, `Điểm còn lại: ${pointsOf.get(s.id) ?? 0}`];
      if (s.endDate) {
        const left = Math.round((s.endDate.getTime() - today.getTime()) / DAY_MS);
        parts.push(left >= 0 ? `còn ${left} ngày` : `quá hạn ${-left} ngày`);
      }
      return `${ctx.projectId ? '' : `[${s.project.key}] `}${parts.join(' · ')}`;
    });
    return { id: 'sprint', title: 'Sprint đang chạy', lines };
  }

  /** Rủi ro / OKR chậm / người quá tải — dùng chung LeadershipService (đã lọc theo dự án người xem thấy). */
  private async leadershipSection(
    block: 'risks' | 'okr' | 'workload',
    ctx: BlockContext,
  ): Promise<DigestSection> {
    const card = LEADERSHIP_CARD_OF[block]!;
    // Một lần cho cả ba khối của cùng lượt dựng; chỉ tải các thẻ người dùng đã chọn.
    ctx.leadership ??= this.leadership.get(ctx.workspaceId, ctx.viewerId, ctx.now, {
      cards: ctx.cards,
      projectId: ctx.projectId,
    });
    const overview = await ctx.leadership;
    const title = { risks: 'Rủi ro nghiêm trọng', okr: 'OKR chậm', workload: 'Người quá tải' }[
      block
    ];
    if (overview.unavailable.includes(card)) {
      return { id: block, title, lines: ['Không tải được mục này.'] };
    }
    if (block === 'risks') {
      const rows = overview.topRisks.slice(0, TOP_N);
      return {
        id: block,
        title,
        lines: rows.length
          ? rows.map(
              (r) =>
                `${r.levelLabel} (${r.score}) · ${r.title}${r.project ? ` · ${r.project.key}` : ''}`,
            )
          : ['Không có rủi ro mở.'],
      };
    }
    if (block === 'okr') {
      const rows = overview.slowGoals.slice(0, LIST_N);
      return {
        id: block,
        title,
        lines: rows.length
          ? rows.map(
              (g) =>
                `${g.name} (${g.period}): ${g.progress}% — thời gian đã trôi ${g.expectedProgress}%`,
            )
          : ['Không có mục tiêu chậm.'],
      };
    }
    const rows = overview.overloaded.slice(0, LIST_N);
    return {
      id: block,
      title,
      lines: rows.length
        ? rows.map(
            (o) =>
              `${o.user.displayName}: ${o.assignedHours}h / ${o.capacityHours}h (${o.weekLabel})`,
          )
        : ['Không ai quá tải.'],
    };
  }

  /** Dự án không ở mức Tốt kèm lý do (ghi đè của quản trị dự án đứng đầu nếu có). */
  private async healthSection(ctx: BlockContext): Promise<DigestSection> {
    const projects = await this.prisma.project.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        ...ctx.visible,
        ...(ctx.projectId ? { id: ctx.projectId } : {}),
      },
      select: { id: true, key: true, name: true },
      orderBy: { key: 'asc' },
    });
    const byId = await this.health.forProjects(
      ctx.workspaceId,
      projects.map((p) => p.id),
      ctx.viewerId,
    );
    const rank = { RED: 0, YELLOW: 1 } as const;
    const label = { RED: 'Nguy cơ', YELLOW: 'Cần chú ý' } as const;
    const bad = projects
      .map((p) => ({ p, h: byId.get(p.id) }))
      .filter(
        (x): x is { p: (typeof projects)[number]; h: NonNullable<typeof x.h> } =>
          x.h?.level === 'RED' || x.h?.level === 'YELLOW',
      )
      .sort((a, b) => rank[a.h.level as 'RED' | 'YELLOW'] - rank[b.h.level as 'RED' | 'YELLOW']);
    const lines = bad.slice(0, HEALTH_N).map(({ p, h }) => {
      const reasons = h.override ? h.override.note : h.auto.reasons.join('; ');
      return `${p.key} — ${p.name}: ${label[h.level as 'RED' | 'YELLOW']}${reasons ? ` (${reasons})` : ''}`;
    });
    return {
      id: 'health',
      title: 'Sức khoẻ dự án',
      lines: lines.length ? lines : ['Mọi dự án đều ở mức Tốt.'],
    };
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
  private async countResolved(ctx: BlockContext, since: Date): Promise<number> {
    try {
      const rows = await this.prisma.issueHistory.findMany({
        where: {
          field: HistoryField.STATUS,
          newCategory: StatusCategory.DONE,
          occurredAt: { gte: since },
          issue: ctx.issueScope,
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
      metrics: string[];
      createdById: string | null;
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
          metrics: true,
          createdById: true,
          lastRunAt: true,
        },
      });
    } catch (err) {
      this.warn('runScheduled.load', err);
      return;
    }

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
          const model = await this.buildDigest(
            sub.workspaceId,
            sub.projectId ?? undefined,
            sub.metrics,
            this.sharedViewer(sub),
          );
          await this.send(sub.workspaceId, sub.channelId, renderTelegramHtml(model));
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

  /** Kênh phải thuộc workspace của người gọi — chặn trỏ digest vào kênh Telegram của workspace khác. */
  private async assertChannelInWorkspace(workspaceId: string, channelId: string): Promise<void> {
    const channel = await this.prisma.integrationChannel.findFirst({
      where: { id: channelId, workspaceId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundAppException('Kênh thông báo');
  }

  private async requireSubscription(workspaceId: string, id: string) {
    const row = await this.prisma.reportSubscription.findFirst({
      where: { id, workspaceId },
    });
    if (!row) throw new NotFoundAppException('Báo cáo định kỳ');
    return row;
  }

  private warn(context: string, err: unknown): void {
    this.logger.warn(
      `Digest (${context}) lỗi: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
