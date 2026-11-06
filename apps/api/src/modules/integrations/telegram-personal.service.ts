import { Injectable, Logger } from '@nestjs/common';
import { IntegrationStatus, IntegrationType, Prisma, type Integration } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { IntegrationsService } from './integrations.service';
import {
  isStopCommand,
  parseStartCommand,
  TELEGRAM_TOKEN_UNUSABLE_MESSAGE,
  TelegramService,
  TelegramTokenRejectedError,
  TelegramUnreachableError,
  TelegramWebhookConflictError,
  type TelegramMessageUpdate,
} from './telegram.service';

/** Cùng bảng chữ không nhập nhằng với mã gắn nhóm (bỏ 0 O 1 I L); mã cá nhân dài hơn vì nằm trong deep link. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
const CODE_SHAPE = /^[A-Z0-9]{10}$/;
const PERSONAL_CODE_TTL_MS = 10 * 60_000;
const CLEANUP_AFTER_MS = 24 * 3600_000;
/** Tin `/start`/`/stop` cũ hơn khoảng này không còn được trả lời (getUpdates đọc lại được 100 tin gần nhất). */
const REPLY_WINDOW_MS = 15 * 60_000;
/** Quét `/stop` theo yêu cầu (mở trang cài đặt) tối đa một lần mỗi khoảng này cho mỗi bot. */
const SWEEP_MIN_INTERVAL_MS = 15_000;
const HANDLED_MAX = 500;

export type PersonalUnavailableReason = 'NO_BOT' | 'PLATFORM_OFF';

export interface PersonalLinkStatus {
  /** Tổ chức có bot Telegram dùng được để liên kết không. */
  available: boolean;
  reason: PersonalUnavailableReason | null;
  botUsername: string | null;
  /** Liên kết hiện tại (không lộ chatId). */
  linked: { username: string | null; linkedAt: string } | null;
}

export interface PersonalLinkCodeResult {
  code: string;
  expiresAt: string;
  botUsername: string | null;
  /** `https://t.me/<bot>?start=<mã>` — null khi chưa biết @username của bot. */
  deepLink: string | null;
  /** Lệnh dự phòng gõ tay trong chat với bot. */
  command: string;
}

export type PersonalPollResult =
  | { status: 'waiting'; hint?: string }
  | { status: 'linked'; username: string | null }
  | { status: 'expired' }
  | { status: 'error'; hint: string };

interface ResolvedBot {
  integration: Integration;
  /** Token đã giải mã; null = dùng bot chung. */
  token: string | null;
  botUsername: string | null;
}

function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

function esc(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function configBotUsername(config: Prisma.JsonValue): string | null {
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    const u = (config as Record<string, unknown>).botUsername;
    if (typeof u === 'string' && u) return u;
  }
  return null;
}

/**
 * Liên kết Telegram CÁ NHÂN: người dùng bấm deep link `t.me/<bot>?start=<mã>`, Telegram gửi `/start <mã>` vào chat riêng
 * với bot. Giống liên kết nhóm (`LinkCodesService`) không webhook / vòng lặp nền: `poll` đọc tin mới nhất theo yêu cầu
 * (getUpdates offset âm) khi giao diện hỏi; cùng lượt đọc đó trả lời `/start` sai mã và xử lý `/stop`.
 */
@Injectable()
export class TelegramPersonalService {
  private readonly logger = new Logger(TelegramPersonalService.name);
  /** Khoá các tin đã trả lời (bộ nhớ tiến trình, có giới hạn) — getUpdates đọc lại cùng tin nhiều lần. */
  private readonly handled = new Set<string>();
  private readonly lastSweep = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Đồng hồ — thuộc tính thường (không phải tham số constructor) để test đặt giờ cố định. */
  clock: () => Date = () => new Date();

  /**
   * Bot dùng để liên kết cá nhân: kết nối TELEGRAM ACTIVE CŨ NHẤT của tổ chức có bot dùng được (token riêng giải mã được,
   * hoặc bot chung). null + lý do khi không có.
   */
  async resolveBot(
    organizationId: string,
  ): Promise<{ bot: ResolvedBot } | { reason: PersonalUnavailableReason }> {
    if (!this.telegram.platformEnabled()) return { reason: 'PLATFORM_OFF' };
    const rows = await this.prisma.integration.findMany({
      where: { organizationId, type: IntegrationType.TELEGRAM, status: IntegrationStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
    });
    for (const integration of rows) {
      const res = this.telegram.resolveBotToken(integration.config);
      if (res.kind === 'unusable') continue;
      if (res.kind === 'global' && !this.telegram.available()) continue;
      const token = res.kind === 'own' ? res.token : null;
      const botUsername =
        configBotUsername(integration.config) ??
        (res.kind === 'global' ? await this.telegram.globalBotUsername().catch(() => null) : null);
      return { bot: { integration, token, botUsername } };
    }
    return { reason: 'NO_BOT' };
  }

  async status(userId: string, organizationId: string): Promise<PersonalLinkStatus> {
    const [resolved, link] = await Promise.all([
      this.resolveBot(organizationId),
      this.prisma.userTelegramLink.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { username: true, linkedAt: true },
      }),
    ]);
    const linked = link ? { username: link.username, linkedAt: link.linkedAt.toISOString() } : null;
    if ('reason' in resolved) {
      return { available: false, reason: resolved.reason, botUsername: null, linked };
    }
    // `/stop` gõ trong bot: xử lý nền (không chặn trang cài đặt) — lần tải sau thấy kết quả.
    if (linked) void this.sweepStops(resolved.bot).catch(() => undefined);
    return { available: true, reason: null, botUsername: resolved.bot.botUsername, linked };
  }

  async createCode(userId: string, organizationId: string): Promise<PersonalLinkCodeResult | null> {
    const resolved = await this.resolveBot(organizationId);
    if ('reason' in resolved) return null;
    const { integration, botUsername } = resolved.bot;
    const now = this.clock();
    const dayAgo = new Date(now.getTime() - CLEANUP_AFTER_MS);
    await this.prisma.userTelegramLinkCode.deleteMany({
      where: { integrationId: integration.id, OR: [{ expiresAt: { lt: dayAgo } }] },
    });
    // Mã mới thay mã cũ của CHÍNH người này (bấm "Liên kết" lần nữa không dồn mã).
    await this.prisma.userTelegramLinkCode.updateMany({
      where: { userId, organizationId, consumedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    const expiresAt = new Date(now.getTime() + PERSONAL_CODE_TTL_MS);
    let code = '';
    for (let attempt = 0; ; attempt += 1) {
      code = generateCode();
      try {
        await this.prisma.userTelegramLinkCode.create({
          data: { code, userId, organizationId, integrationId: integration.id, expiresAt },
        });
        break;
      } catch (e) {
        const collision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!collision || attempt >= 4) throw e;
      }
    }
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      botUsername,
      deepLink: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
      command: `/start ${code}`,
    };
  }

  async poll(userId: string, organizationId: string, rawCode: string): Promise<PersonalPollResult> {
    const code = rawCode.trim().toUpperCase();
    if (!CODE_SHAPE.test(code)) return { status: 'expired' };
    const row = await this.prisma.userTelegramLinkCode.findFirst({
      where: { code, userId, organizationId },
    });
    const now = this.clock();
    if (!row || row.consumedAt || row.expiresAt <= now) return { status: 'expired' };

    const integration = await this.prisma.integration.findFirst({
      where: {
        id: row.integrationId,
        organizationId,
        type: IntegrationType.TELEGRAM,
        status: IntegrationStatus.ACTIVE,
      },
    });
    if (!integration) {
      return {
        status: 'error',
        hint: 'Bot Telegram của tổ chức không còn hoạt động — nhờ quản trị tổ chức kiểm tra ở Kết nối › Telegram',
      };
    }
    const res = this.telegram.resolveBotToken(integration.config);
    if (res.kind === 'unusable') {
      await this.integrations.reportUnusableToken(integration.id);
      return { status: 'error', hint: TELEGRAM_TOKEN_UNUSABLE_MESSAGE };
    }
    if (res.kind === 'global' && !this.telegram.available()) {
      return {
        status: 'error',
        hint: 'Hệ thống chưa có bot chung — nhờ quản trị tổ chức kiểm tra',
      };
    }
    const token = res.kind === 'own' ? res.token : null;
    const bot: ResolvedBot = {
      integration,
      token,
      botUsername: configBotUsername(integration.config),
    };

    let updates: TelegramMessageUpdate[];
    try {
      updates = await this.telegram.recentUpdates(token);
    } catch (err) {
      if (err instanceof TelegramWebhookConflictError) {
        return {
          status: 'error',
          hint: 'Telegram không cho đọc tin nhắn của bot này (bot đang gắn webhook hoặc có tiến trình khác đang đọc tin) — nhờ quản trị tổ chức xử lý',
        };
      }
      if (err instanceof TelegramTokenRejectedError) {
        await this.integrations.reportUnusableToken(integration.id);
        return {
          status: 'error',
          hint: 'Telegram từ chối token của bot này — nhờ quản trị tổ chức kết nối lại',
        };
      }
      if (err instanceof TelegramUnreachableError) {
        return { status: 'waiting', hint: 'Chưa kết nối được tới Telegram — đang thử lại…' };
      }
      throw err;
    }

    const priv = updates.filter((u) => u.chatType === 'private');
    // Tin khớp CŨ NHẤT thắng: người khác thấy mã (vd nhìn trộm màn hình) rồi gõ lại sau không chen vào được.
    const hit = priv.find((u) => parseStartCommand(u.text, bot.botUsername)?.code === code);
    if (!hit) {
      await this.housekeeping(bot, priv, code).catch(() => undefined);
      return { status: 'waiting' };
    }

    // Tiêu thụ mã bằng CAS: hai request song song chỉ một bên thắng.
    const { count } = await this.prisma.userTelegramLinkCode.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (count === 0) return { status: 'expired' };

    const chatId = String(hit.chatId);
    const username = hit.username ?? null;
    try {
      // Một chat chỉ gắn một người cho mỗi bot: liên kết lại bằng tài khoản khác thì thay.
      await this.prisma.userTelegramLink.deleteMany({
        where: { integrationId: integration.id, chatId, NOT: { userId } },
      });
      await this.prisma.userTelegramLink.upsert({
        where: { userId_organizationId: { userId, organizationId } },
        create: { userId, organizationId, integrationId: integration.id, chatId, username },
        update: { integrationId: integration.id, chatId, username, linkedAt: now },
      });
    } catch (e) {
      // Không để mã bị "đốt" vì lỗi của mình.
      await this.prisma.userTelegramLinkCode.updateMany({
        where: { id: row.id },
        data: { consumedAt: null },
      });
      throw e;
    }
    await this.reply(bot, chatId, await this.confirmText(organizationId));
    return { status: 'linked', username };
  }

  /** Huỷ liên kết của chính mình (nút "Huỷ liên kết"). Không có liên kết cũng không lỗi. */
  async unlink(userId: string, organizationId: string): Promise<{ success: true }> {
    await this.prisma.userTelegramLink.deleteMany({ where: { userId, organizationId } });
    return { success: true };
  }

  private async confirmText(organizationId: string): Promise<string> {
    const org = await this.prisma.organization
      .findUnique({ where: { id: organizationId }, select: { name: true } })
      .catch(() => null);
    return `✅ Đã liên kết với Tirapro (${esc(org?.name ?? '')}). Thông báo bạn chọn sẽ gửi vào đây — gõ /stop để huỷ liên kết.`;
  }

  /** Bot trả lời vào chat; lỗi gửi không làm hỏng việc đang làm. */
  private async reply(bot: ResolvedBot, chatId: string, text: string): Promise<void> {
    try {
      await this.telegram.send(bot.token, chatId, text);
    } catch (err) {
      this.logger.warn(
        `Không gửi được tin trả lời Telegram: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Đánh dấu đã xử lý; trả false nếu đã xử lý rồi. Có giới hạn kích thước. */
  private markHandled(key: string): boolean {
    if (this.handled.has(key)) return false;
    if (this.handled.size >= HANDLED_MAX) {
      const first = this.handled.values().next().value;
      if (first !== undefined) this.handled.delete(first);
    }
    this.handled.add(key);
    return true;
  }

  private recent(u: TelegramMessageUpdate): boolean {
    return this.clock().getTime() - u.date * 1000 <= REPLY_WINDOW_MS;
  }

  /**
   * Việc phụ trong cùng lượt đọc: báo rõ khi ai đó gõ `/start` sai/hết hạn mã hoặc không kèm mã (mã đang chờ của người khác
   * thì để yên — poll của họ sẽ xử lý), và xử lý `/stop`.
   */
  private async housekeeping(
    bot: ResolvedBot,
    priv: TelegramMessageUpdate[],
    polledCode: string,
  ): Promise<void> {
    const now = this.clock();
    for (const u of priv) {
      const start = parseStartCommand(u.text, bot.botUsername);
      if (!start || !this.recent(u)) continue;
      if (start.code === polledCode) continue;
      if (start.code && CODE_SHAPE.test(start.code)) {
        const other = await this.prisma.userTelegramLinkCode.findFirst({
          where: { code: start.code, integrationId: bot.integration.id },
          select: { consumedAt: true, expiresAt: true },
        });
        if (other && !other.consumedAt && other.expiresAt > now) continue; // của người khác, đang chờ
      }
      if (!this.markHandled(`start:${bot.integration.id}:${u.chatId}:${u.date}:${u.text}`))
        continue;
      await this.reply(
        bot,
        String(u.chatId),
        start.code
          ? '⚠️ Mã không đúng hoặc đã hết hạn. Mở Tirapro › Cài đặt › Thông báo, bấm “Liên kết Telegram” để lấy mã mới.'
          : 'Để nhận thông báo Tirapro ở đây, mở Tirapro › Cài đặt › Thông báo rồi bấm “Liên kết Telegram”.',
      );
    }
    await this.processStops(bot, priv);
  }

  /** Quét `/stop` (đọc tin mới nhất) — gọi nền từ `status`, giới hạn tần suất theo bot. */
  private async sweepStops(bot: ResolvedBot): Promise<void> {
    const nowMs = this.clock().getTime();
    const last = this.lastSweep.get(bot.integration.id) ?? 0;
    if (nowMs - last < SWEEP_MIN_INTERVAL_MS) return;
    this.lastSweep.set(bot.integration.id, nowMs);
    let updates: TelegramMessageUpdate[];
    try {
      updates = await this.telegram.recentUpdates(bot.token);
    } catch {
      return; // webhook / mạng / token: im lặng — chỉ là việc phụ
    }
    await this.processStops(
      bot,
      updates.filter((u) => u.chatType === 'private'),
    );
  }

  /** `/stop` từ chat đã liên kết, gõ SAU lúc liên kết → xoá liên kết + báo lại. */
  private async processStops(bot: ResolvedBot, priv: TelegramMessageUpdate[]): Promise<void> {
    for (const u of priv) {
      if (!isStopCommand(u.text, bot.botUsername)) continue;
      const chatId = String(u.chatId);
      const link = await this.prisma.userTelegramLink.findFirst({
        where: { integrationId: bot.integration.id, chatId },
        select: { id: true, linkedAt: true },
      });
      if (!link || u.date * 1000 <= link.linkedAt.getTime()) continue;
      const { count } = await this.prisma.userTelegramLink.deleteMany({ where: { id: link.id } });
      if (count === 0) continue;
      await this.reply(
        bot,
        chatId,
        'Đã huỷ liên kết — bạn sẽ không nhận thông báo Tirapro ở đây nữa.',
      );
    }
  }
}
