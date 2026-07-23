import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { Prisma, IntegrationType, IntegrationStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { TelegramService } from './telegram.service';

/** Cấu hình lưu trong Integration.config (botToken đã mã hóa). */
interface TelegramConfig {
  botToken: string | null;
  useGlobal: boolean;
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
  ) {}

  // ----------------------------- CRUD -----------------------------

  /** Liệt kê integration của workspace (redact botToken). */
  async list(workspaceId: string, type?: IntegrationType): Promise<IntegrationDto[]> {
    const rows = await this.prisma.integration.findMany({
      where: { workspaceId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.redact(r));
  }

  /** Tạo integration Telegram; lưu botToken đã mã hóa (nếu có). */
  async createTelegram(
    workspaceId: string,
    userId: string,
    input: CreateTelegramInput,
  ): Promise<IntegrationDto> {
    const config: TelegramConfig = {
      botToken: input.botToken ? this.telegram.encrypt(input.botToken) : null,
      useGlobal: !input.botToken,
    };
    const row = await this.prisma.integration.create({
      data: {
        workspaceId,
        type: IntegrationType.TELEGRAM,
        name: input.name,
        config: config as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    return this.redact(row);
  }

  /** Xóa integration (cascade kênh). */
  async remove(workspaceId: string, integrationId: string): Promise<{ success: true }> {
    await this.requireIntegration(workspaceId, integrationId);
    await this.prisma.integration.delete({ where: { id: integrationId } });
    return { success: true };
  }

  // --------------------------- Channels ---------------------------

  async addChannel(workspaceId: string, integrationId: string, input: AddChannelInput) {
    await this.requireIntegration(workspaceId, integrationId);
    try {
      return await this.prisma.integrationChannel.create({
        data: {
          integrationId,
          workspaceId,
          externalId: input.externalId,
          title: input.title ?? null,
          events: input.events ?? [],
          projectId: input.projectId ?? null,
        },
      });
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

  async removeChannel(workspaceId: string, channelId: string): Promise<{ success: true }> {
    const channel = await this.prisma.integrationChannel.findFirst({
      where: { id: channelId, workspaceId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundAppException('Kênh');
    await this.prisma.integrationChannel.delete({ where: { id: channelId } });
    return { success: true };
  }

  // ------------------------------ Test ----------------------------

  /** Gửi tin nhắn kiểm tra tới mọi kênh đang bật của integration. */
  async test(
    workspaceId: string,
    integrationId: string,
  ): Promise<{ sent: number; total: number; enabled: boolean }> {
    const integration = await this.requireIntegration(workspaceId, integrationId);
    const token = this.resolveToken(integration.config);
    const channels = await this.prisma.integrationChannel.findMany({
      where: { integrationId, workspaceId, isEnabled: true },
    });
    const text = '✅ Tirapro đã kết nối';
    let sent = 0;
    for (const ch of channels) {
      const ok = await this.telegram.send(token, ch.externalId, text);
      if (ok) sent += 1;
    }
    return { sent, total: channels.length, enabled: this.telegram.available(token) };
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
      const token = this.resolveToken(integration.config);
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

  /** Giải mã botToken từ config; null → dùng token toàn cục. */
  private resolveToken(config: Prisma.JsonValue): string | null {
    const cfg = this.asTelegramConfig(config);
    if (!cfg.botToken) return null;
    return this.telegram.decrypt(cfg.botToken);
  }

  private asTelegramConfig(config: Prisma.JsonValue): TelegramConfig {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const obj = config as Record<string, unknown>;
      return {
        botToken: typeof obj.botToken === 'string' ? obj.botToken : null,
        useGlobal: obj.useGlobal !== false,
      };
    }
    return { botToken: null, useGlobal: true };
  }

  /** Trả DTO đã ẩn botToken (thay bằng '***' nếu có). */
  private redact(row: {
    id: string;
    workspaceId: string;
    type: IntegrationType;
    name: string;
    config: Prisma.JsonValue;
    status: IntegrationStatus;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): IntegrationDto {
    const config: Record<string, unknown> =
      row.config && typeof row.config === 'object' && !Array.isArray(row.config)
        ? { ...(row.config as Record<string, unknown>) }
        : {};
    if (config.botToken) config.botToken = '***';
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
    };
  }
}
