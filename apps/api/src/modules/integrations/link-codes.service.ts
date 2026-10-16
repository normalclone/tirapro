import { Injectable, Logger } from '@nestjs/common';
import { Prisma, IntegrationType } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { IntegrationsService } from './integrations.service';
import {
  TELEGRAM_TOKEN_UNUSABLE_MESSAGE,
  TelegramService,
  TelegramTokenRejectedError,
  TelegramUnreachableError,
  TelegramWebhookConflictError,
  parseLinkCommand,
} from './telegram.service';

/** Bảng chữ không nhập nhằng (bỏ 0 O 1 I L). */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LINK_CODE_LENGTH = 6;
const LINK_CODE_TTL_MS = 15 * 60_000;
const CLEANUP_AFTER_MS = 24 * 3600_000;
const ACCEPTED_CHAT_TYPES = new Set(['group', 'supergroup', 'private']);
const CODE_SHAPE = /^[A-Z0-9]{6}$/;

export interface LinkCodeResult {
  code: string;
  expiresAt: string;
  botUsername: string | null;
  command: string;
  startGroupUrl: string | null;
}

export type PollResult =
  | { status: 'waiting'; hint?: string }
  | { status: 'linked'; channel: { id: string; externalId: string; title: string | null } }
  | { status: 'expired' }
  | { status: 'error'; hint: string };

function generateCode(): string {
  let out = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1) {
    out += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return out;
}

function esc(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/**
 * Liên kết nhóm Telegram bằng mã `/link@TenBot MÃ` — admin không cần biết chat_id.
 * Không webhook / vòng lặp nền: `poll` đọc tin mới nhất theo yêu cầu khi giao diện hỏi.
 */
@Injectable()
export class LinkCodesService {
  private readonly logger = new Logger(LinkCodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Đồng hồ — thuộc tính thường (KHÔNG phải tham số constructor: Nest sẽ cố tiêm) để test đặt giờ cố định. */
  clock: () => Date = () => new Date();

  private async requireTelegram(workspaceId: string, integrationId: string) {
    const row = await this.prisma.integration.findFirst({
      where: { id: integrationId, workspaceId, type: IntegrationType.TELEGRAM },
    });
    if (!row) throw new NotFoundAppException('Tích hợp');
    return row;
  }

  private configBotUsername(config: Prisma.JsonValue): string | null {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const u = (config as Record<string, unknown>).botUsername;
      if (typeof u === 'string' && u) return u;
    }
    return null;
  }

  async createCode(
    workspaceId: string,
    integrationId: string,
    userId: string,
    projectId?: string,
  ): Promise<LinkCodeResult> {
    const integration = await this.requireTelegram(workspaceId, integrationId);
    if (projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!project) throw new NotFoundAppException('Dự án');
    }
    const now = this.clock();
    const dayAgo = new Date(now.getTime() - CLEANUP_AFTER_MS);
    await this.prisma.channelLinkToken.deleteMany({
      where: {
        integrationId,
        OR: [{ expiresAt: { lt: dayAgo } }, { consumedAt: { lt: dayAgo } }],
      },
    });
    // Mã mới thay mã cũ: vô hiệu mọi mã còn hiệu lực chưa dùng của tích hợp (bấm "Tạo mã mới"/Quay lại không dồn mã,
    // và mã cũ lộ trong nhóm không còn dùng được). Mã bị vô hiệu → poll trả `expired`.
    await this.prisma.channelLinkToken.updateMany({
      where: { integrationId, consumedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
    let code = '';
    for (let attempt = 0; ; attempt += 1) {
      code = generateCode();
      try {
        await this.prisma.channelLinkToken.create({
          data: {
            token: code,
            workspaceId,
            projectId: projectId ?? null,
            integrationType: IntegrationType.TELEGRAM,
            integrationId,
            createdById: userId,
            expiresAt,
          },
        });
        break;
      } catch (e) {
        const collision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!collision || attempt >= 4) throw e;
      }
    }
    const botUsername =
      this.configBotUsername(integration.config) ??
      (await this.telegram.globalBotUsername().catch(() => null));
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      botUsername,
      command: botUsername ? `/link@${botUsername} ${code}` : `/link ${code}`,
      startGroupUrl: botUsername ? `https://t.me/${botUsername}?startgroup=true` : null,
    };
  }

  async poll(workspaceId: string, integrationId: string, rawCode: string): Promise<PollResult> {
    const integration = await this.requireTelegram(workspaceId, integrationId);
    const code = rawCode.trim().toUpperCase();
    if (!CODE_SHAPE.test(code)) return { status: 'expired' };
    const row = await this.prisma.channelLinkToken.findFirst({
      where: { token: code, integrationId, workspaceId },
    });
    const now = this.clock();
    if (!row || row.consumedAt || row.expiresAt <= now) return { status: 'expired' };

    const res = this.telegram.resolveBotToken(integration.config);
    if (res.kind === 'unusable') {
      await this.integrations.reportUnusableToken(integration.id);
      return { status: 'error', hint: TELEGRAM_TOKEN_UNUSABLE_MESSAGE };
    }
    if (res.kind === 'global' && !this.telegram.available()) {
      return {
        status: 'error',
        hint: 'Hệ thống chưa có bot chung — hãy kết nối lại bằng token bot của bạn',
      };
    }
    const token = res.kind === 'own' ? res.token : null;

    let updates;
    try {
      updates = await this.telegram.recentUpdates(token);
    } catch (err) {
      if (err instanceof TelegramWebhookConflictError) {
        return {
          status: 'error',
          hint: 'Telegram không cho đọc tin nhắn của bot này: bot đang gắn webhook hoặc có tiến trình khác đang đọc tin của nó (getUpdates) — hãy gỡ webhook/tắt tiến trình đó, hoặc dùng bot riêng cho Tirapro',
        };
      }
      if (err instanceof TelegramTokenRejectedError) {
        await this.integrations.reportUnusableToken(integration.id);
        return {
          status: 'error',
          hint: 'Telegram từ chối token của bot này — hãy kết nối lại bằng token mới từ @BotFather',
        };
      }
      if (err instanceof TelegramUnreachableError) {
        return { status: 'waiting', hint: 'Chưa kết nối được tới Telegram — đang thử lại…' };
      }
      throw err;
    }

    const botUsername = this.configBotUsername(integration.config);
    // Bản tin khớp CŨ NHẤT thắng (Telegram trả theo thứ tự thời gian): người khác thấy mã trong nhóm rồi gõ lại ở
    // nhóm lạ sau đó không chen vào được.
    const hit = updates.find(
      (u) => ACCEPTED_CHAT_TYPES.has(u.chatType) && parseLinkCommand(u.text, botUsername) === code,
    );
    if (!hit) return { status: 'waiting' };

    // Tiêu thụ mã bằng CAS: hai request song song chỉ một bên thắng.
    const { count } = await this.prisma.channelLinkToken.updateMany({
      where: {
        token: code,
        integrationId,
        workspaceId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (count === 0) return { status: 'expired' };

    const externalId = String(hit.chatId);
    const title = hit.chatTitle ?? hit.firstName ?? null;
    let channel: { id: string; externalId: string; title: string | null } | null;
    try {
      channel = await this.findChannel(integrationId, externalId, row.projectId);
      if (!channel) {
        try {
          channel = await this.integrations.addChannel(
            workspaceId,
            integrationId,
            { externalId, title: title ?? undefined, projectId: row.projectId ?? undefined },
            row.createdById,
          );
        } catch (e) {
          // Va chạm unique (đã liên kết ở request khác) → coi như đã liên kết.
          channel = await this.findChannel(integrationId, externalId, row.projectId);
          if (!channel) throw e;
        }
      }
    } catch (e) {
      // Không để mã bị "đốt" vì lỗi của mình: trả về chưa dùng để thử lại.
      await this.prisma.channelLinkToken.updateMany({
        where: { id: row.id },
        data: { consumedAt: null },
      });
      throw e;
    }

    await this.confirmInChat(token, externalId, workspaceId);
    return {
      status: 'linked',
      channel: { id: channel.id, externalId: channel.externalId, title: channel.title },
    };
  }

  private findChannel(integrationId: string, externalId: string, projectId: string | null) {
    return this.prisma.integrationChannel.findFirst({
      where: { integrationId, externalId, projectId },
      select: { id: true, externalId: true, title: true },
    });
  }

  /** Bot trả lời xác nhận vào chat; lỗi gửi không làm hỏng việc liên kết. */
  private async confirmInChat(
    token: string | null,
    chatId: string,
    workspaceId: string,
  ): Promise<void> {
    try {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { name: true },
      });
      await this.telegram.send(
        token,
        chatId,
        `✅ Đã liên kết với Tirapro — không gian "${esc(ws?.name ?? '')}"`,
      );
    } catch (err) {
      this.logger.warn(
        `Không gửi được tin xác nhận liên kết: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
