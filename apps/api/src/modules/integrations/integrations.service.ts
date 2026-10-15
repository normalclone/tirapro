import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AUDIT_ACTIONS, DOMAIN_EVENTS } from '@tirapro/types';
import { Prisma, IntegrationType, IntegrationStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../audit/audit.service';
import {
  TELEGRAM_TOKEN_UNUSABLE_MESSAGE,
  TelegramService,
  TelegramUnreachableError,
} from './telegram.service';
import { telegramHealth, type TelegramHealth } from './telegram-health';

/** Cấu hình lưu trong Integration.config (botToken đã mã hóa). */
interface TelegramConfig {
  botToken: string | null;
  useGlobal: boolean;
  /** @username của bot (không phải bí mật) — lấy từ getMe lúc kết nối. */
  botUsername?: string | null;
}

/** Kết quả lần "Kiểm tra" gần nhất, lưu trong config. */
export interface TelegramLastTest {
  at: string;
  ok: boolean;
  sent: number;
  total: number;
}

export type TelegramTestReason = 'NO_CHANNEL' | 'NO_BOT' | 'PLATFORM_OFF';

export interface TelegramTestResult {
  sent: number;
  total: number;
  enabled: boolean;
  ok: boolean;
  reason?: TelegramTestReason;
}

/** Integration đã redact (không lộ botToken). */
interface IntegrationDto {
  id: string;
  workspaceId: string;
  type: IntegrationType;
  name: string;
  config: Record<string, unknown>;
  status: IntegrationStatus;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** @username của bot Telegram (null: chưa biết / không phải Telegram). */
  botUsername: string | null;
  /** Trạng thái thật (Sẵn sàng / Chưa có kênh / Chưa có bot / Lỗi token / Tắt toàn hệ thống). */
  health: TelegramHealth;
  lastTest: TelegramLastTest | null;
}

interface CreateTelegramInput {
  name: string;
  botToken?: string;
}

interface AddChannelInput {
  externalId: string;
  title?: string;
  events?: string[];
  projectId?: string;
}

/** Issue payload đi kèm domain event (issue.* ). */
interface IssueEventPayload {
  issue: {
    workspaceId: string;
    key: string;
    summary: string;
    status?: { name?: string } | null;
    projectId: string;
  };
  actorId?: string;
}

/** Comment payload đi kèm comment.added. */
interface CommentEventPayload {
  comment?: { body?: string } | null;
  issueId: string;
  projectId?: string;
  actorId?: string;
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function esc(value: string): string {
  return value.replace(/[&<>]/g, (c) => HTML_ESCAPE[c] ?? c);
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------- CRUD -----------------------------

  /** Liệt kê integration của workspace (redact botToken). */
  async list(workspaceId: string, type?: IntegrationType): Promise<IntegrationDto[]> {
    const rows = await this.prisma.integration.findMany({
      where: { workspaceId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { channels: { where: { isEnabled: true } } } } },
    });
    return rows.map((r) => this.redact(r, r._count.channels));
  }

  /** Cờ hệ thống + bot chung — wizard dùng để biết có cho chọn "bot chung" không. */
  async platform(): Promise<{
    platformEnabled: boolean;
    globalBotAvailable: boolean;
    globalBotUsername: string | null;
  }> {
    const globalBotAvailable = this.telegram.available();
    return {
      platformEnabled: this.telegram.platformEnabled(),
      globalBotAvailable,
      globalBotUsername: globalBotAvailable ? await this.telegram.globalBotUsername() : null,
    };
  }

  /** Tạo integration Telegram; lưu botToken đã mã hóa (nếu có). */
  async createTelegram(
    workspaceId: string,
    userId: string,
    input: CreateTelegramInput,
  ): Promise<IntegrationDto> {
    const config = await this.buildTelegramConfig(input.botToken);
    const row = await this.prisma.integration.create({
      data: {
        workspaceId,
        type: IntegrationType.TELEGRAM,
        name: input.name,
        config: config as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    // Không ghi botToken/config vào nhật ký — chỉ loại + tên.
    await this.audit.record({
      workspaceId,
      actorId: userId,
      action: AUDIT_ACTIONS.INTEGRATION_CREATED,
      entityType: 'integration',
      entityId: row.id,
      summary: `Tạo tích hợp Telegram "${row.name}"`,
      meta: { type: row.type, name: row.name },
    });
    return this.redact(row, 0);
  }

  /**
   * Xác thực bot TRƯỚC khi lưu: token riêng → getMe (401/404 = sai token; lỗi mạng = thử lại sau);
   * không token → bắt buộc có bot chung của hệ thống. Không bao giờ dựng kết nối "mồ côi" không có bot.
   */
  private async buildTelegramConfig(botToken?: string): Promise<TelegramConfig> {
    if (botToken) {
      let me;
      try {
        me = await this.telegram.getMe(botToken);
      } catch (err) {
        if (err instanceof TelegramUnreachableError) {
          throw new BusinessRuleException('Không kết nối được tới Telegram — thử lại sau');
        }
        throw err;
      }
      if (!me) {
        throw new BusinessRuleException('Token bot không hợp lệ — hãy copy lại từ @BotFather');
      }
      return {
        botToken: this.telegram.encrypt(botToken),
        useGlobal: false,
        botUsername: me.username,
      };
    }
    if (!this.telegram.available()) {
      throw new BusinessRuleException(
        'Hệ thống chưa có bot chung — hãy dán token bot của bạn (tạo ở @BotFather)',
      );
    }
    const botUsername = await this.telegram.globalBotUsername().catch(() => null);
    return { botToken: null, useGlobal: true, botUsername };
  }

  /** Xóa integration (cascade kênh). */
  async remove(
    workspaceId: string,
    integrationId: string,
    actorId?: string,
  ): Promise<{ success: true }> {
    const integration = await this.requireIntegration(workspaceId, integrationId);
    await this.prisma.integration.delete({ where: { id: integrationId } });
    await this.audit.record({
      workspaceId,
      actorId,
      action: AUDIT_ACTIONS.INTEGRATION_DELETED,
      entityType: 'integration',
      entityId: integrationId,
      summary: `Xoá tích hợp ${integration.type === IntegrationType.TELEGRAM ? 'Telegram ' : ''}"${integration.name}"`,
      meta: { type: integration.type, name: integration.name },
    });
    return { success: true };
  }

  // --------------------------- Channels ---------------------------

  async addChannel(
    workspaceId: string,
    integrationId: string,
    input: AddChannelInput,
    actorId?: string,
  ) {
    const integration = await this.requireIntegration(workspaceId, integrationId);
    try {
      const channel = await this.prisma.integrationChannel.create({
        data: {
          integrationId,
          workspaceId,
          externalId: input.externalId,
          title: input.title ?? null,
          events: input.events ?? [],
          projectId: input.projectId ?? null,
        },
      });
      await this.audit.record({
        workspaceId,
        actorId,
        action: AUDIT_ACTIONS.INTEGRATION_CHANNEL_ADDED,
        entityType: 'integration_channel',
        entityId: channel.id,
        summary: `Thêm kênh "${input.title ?? input.externalId}" vào tích hợp "${integration.name}"`,
        meta: { integrationId, title: input.title ?? null, events: input.events ?? [] },
      });
      return channel;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Kênh đã tồn tại');
      }
      throw e;
    }
  }

  async listChannels(workspaceId: string, integrationId: string) {
    await this.requireIntegration(workspaceId, integrationId);
    return this.prisma.integrationChannel.findMany({
      where: { integrationId, workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeChannel(
    workspaceId: string,
    channelId: string,
    actorId?: string,
  ): Promise<{ success: true }> {
    const channel = await this.prisma.integrationChannel.findFirst({
      where: { id: channelId, workspaceId },
      select: { id: true, title: true, externalId: true, integrationId: true },
    });
    if (!channel) throw new NotFoundAppException('Kênh');
    await this.prisma.integrationChannel.delete({ where: { id: channelId } });
    await this.audit.record({
      workspaceId,
      actorId,
      action: AUDIT_ACTIONS.INTEGRATION_CHANNEL_REMOVED,
      entityType: 'integration_channel',
      entityId: channelId,
      summary: `Gỡ kênh "${channel.title ?? channel.externalId}" khỏi tích hợp`,
      meta: { integrationId: channel.integrationId },
    });
    return { success: true };
  }

  // ------------------------------ Test ----------------------------

  /**
   * Gửi tin nhắn kiểm tra tới mọi kênh đang bật. Không gửi được vì nguyên nhân cấu hình thì trả
   * `reason` (PLATFORM_OFF / NO_BOT / NO_CHANNEL) thay vì "đã gửi 0/0"; mỗi lần có gửi đều ghi
   * `config.lastTest` để giao diện hiện "Gửi thử gần nhất …".
   */
  async test(workspaceId: string, integrationId: string): Promise<TelegramTestResult> {
    const integration = await this.requireIntegration(workspaceId, integrationId);
    const res = this.telegram.resolveBotToken(integration.config);
    if (res.kind === 'unusable') {
      await this.reportUnusableToken(integration.id);
      throw new BusinessRuleException(TELEGRAM_TOKEN_UNUSABLE_MESSAGE);
    }
    if (integration.status === IntegrationStatus.ERROR) {
      // Token dùng được trở lại → "Gửi thử" đóng vai trò kiểm lại, phục hồi trạng thái.
      await this.prisma.integration.updateMany({
        where: { id: integration.id, status: IntegrationStatus.ERROR },
        data: { status: IntegrationStatus.ACTIVE },
      });
    }
    const token = res.kind === 'own' ? res.token : null;
    const enabled = this.telegram.available(token);
    if (!this.telegram.platformEnabled()) {
      return { sent: 0, total: 0, enabled, ok: false, reason: 'PLATFORM_OFF' };
    }
    if (!enabled) return { sent: 0, total: 0, enabled, ok: false, reason: 'NO_BOT' };
    const channels = await this.prisma.integrationChannel.findMany({
      where: { integrationId, workspaceId, isEnabled: true },
    });
    if (channels.length === 0)
      return { sent: 0, total: 0, enabled, ok: false, reason: 'NO_CHANNEL' };
    const text = '✅ Tirapro đã kết nối';
    let sent = 0;
    for (const ch of channels) {
      const ok = await this.telegram.send(token, ch.externalId, text);
      if (ok) sent += 1;
    }
    const ok = sent === channels.length;
    const lastTest: TelegramLastTest = {
      at: new Date().toISOString(),
      ok,
      sent,
      total: channels.length,
    };
    const base =
      integration.config &&
      typeof integration.config === 'object' &&
      !Array.isArray(integration.config)
        ? (integration.config as Record<string, unknown>)
        : {};
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: { config: { ...base, lastTest } as unknown as Prisma.InputJsonValue },
    });
    return { sent, total: channels.length, enabled, ok };
  }

  // -------------------------- Producers ---------------------------

  @OnEvent(DOMAIN_EVENTS.ISSUE_TRANSITIONED)
  async onIssueTransitioned(payload: IssueEventPayload): Promise<void> {
    await this.dispatchIssue(payload, 'STATUS_CHANGED');
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_UPDATED)
  async onIssueUpdated(payload: IssueEventPayload): Promise<void> {
    await this.dispatchIssue(payload, 'ISSUE_UPDATED');
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_ADDED)
  async onCommentAdded(payload: CommentEventPayload): Promise<void> {
    try {
      const issue = await this.prisma.issue.findUnique({
        where: { id: payload.issueId },
        select: { workspaceId: true, key: true, summary: true, projectId: true },
      });
      if (!issue) return;
      const msg = `💬 <b>${esc(issue.key)}</b> có bình luận mới: <i>${esc(issue.summary)}</i>`;
      await this.fanout(issue.workspaceId, issue.projectId, 'COMMENT_ADDED', msg);
    } catch (err) {
      this.logger.warn(
        `Telegram producer (comment.added) lỗi: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async dispatchIssue(payload: IssueEventPayload, notificationType: string): Promise<void> {
    try {
      const issue = payload?.issue;
      if (!issue?.workspaceId) return;
      const statusName = issue.status?.name ?? '—';
      const msg =
        notificationType === 'STATUS_CHANGED'
          ? `<b>${esc(issue.key)}</b> chuyển sang <i>${esc(statusName)}</i>`
          : `✏️ <b>${esc(issue.key)}</b> được cập nhật: <i>${esc(issue.summary)}</i>`;
      await this.fanout(issue.workspaceId, issue.projectId, notificationType, msg);
    } catch (err) {
      this.logger.warn(
        `Telegram producer (${notificationType}) lỗi: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Tìm integration TELEGRAM ACTIVE + kênh đang bật trong workspace (lọc theo project nếu kênh có
   * projectId) mà events rỗng (=tất cả) hoặc chứa notificationType; gửi message.
   */
  private async fanout(
    workspaceId: string,
    projectId: string | undefined,
    notificationType: string,
    message: string,
  ): Promise<void> {
    const integrations = await this.prisma.integration.findMany({
      where: { workspaceId, type: IntegrationType.TELEGRAM, status: IntegrationStatus.ACTIVE },
      include: { channels: { where: { isEnabled: true } } },
    });
    for (const integration of integrations) {
      const res = this.telegram.resolveBotToken(integration.config);
      if (res.kind === 'unusable') {
        await this.reportUnusableToken(integration.id);
        continue;
      }
      const token = res.kind === 'own' ? res.token : null;
      for (const channel of integration.channels) {
        if (channel.projectId && projectId && channel.projectId !== projectId) continue;
        const wantsAll = channel.events.length === 0;
        if (!wantsAll && !channel.events.includes(notificationType)) continue;
        await this.telegram.send(token, channel.externalId, message);
      }
    }
  }

  // ----------------------------- Helpers --------------------------

  private async requireIntegration(workspaceId: string, integrationId: string) {
    const row = await this.prisma.integration.findFirst({
      where: { id: integrationId, workspaceId },
    });
    if (!row) throw new NotFoundAppException('Tích hợp');
    return row;
  }

  /** Token riêng không giải mã được: ngừng gửi và đánh dấu ERROR (chỉ chuyển từ ACTIVE, log một lần). */
  async reportUnusableToken(integrationId: string): Promise<void> {
    const { count } = await this.prisma.integration.updateMany({
      where: { id: integrationId, status: IntegrationStatus.ACTIVE },
      data: { status: IntegrationStatus.ERROR },
    });
    if (count > 0) {
      this.logger.warn(
        `Tích hợp ${integrationId}: token bot không dùng được — đã chuyển sang trạng thái ERROR`,
      );
    }
  }

  /** Trả DTO đã ẩn botToken (thay bằng '***' nếu có) + health tính lúc đọc. */
  private redact(
    row: {
      id: string;
      workspaceId: string;
      type: IntegrationType;
      name: string;
      config: Prisma.JsonValue;
      status: IntegrationStatus;
      createdById: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    enabledChannelCount: number,
  ): IntegrationDto {
    const config: Record<string, unknown> =
      row.config && typeof row.config === 'object' && !Array.isArray(row.config)
        ? { ...(row.config as Record<string, unknown>) }
        : {};
    const hasOwnToken = Boolean(config.botToken);
    if (config.botToken) config.botToken = '***';
    const lastTest = parseLastTest(config.lastTest);
    delete config.lastTest;
    const botUsername = typeof config.botUsername === 'string' ? config.botUsername : null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      type: row.type,
      name: row.name,
      config,
      status: row.status,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      botUsername,
      health: telegramHealth({
        status: row.status,
        hasOwnToken,
        globalAvailable: this.telegram.available(),
        platformEnabled: this.telegram.platformEnabled(),
        channelCount: enabledChannelCount,
      }),
      lastTest,
    };
  }
}

function parseLastTest(raw: unknown): TelegramLastTest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.at !== 'string' ||
    typeof r.ok !== 'boolean' ||
    typeof r.sent !== 'number' ||
    typeof r.total !== 'number'
  ) {
    return null;
  }
  return { at: r.at, ok: r.ok, sent: r.sent, total: r.total };
}
