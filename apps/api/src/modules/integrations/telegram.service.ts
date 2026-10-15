import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
import { Telegraf, TelegramError } from 'telegraf';
import { SystemSettingsService } from '../system-settings/system-settings.service';

export const TELEGRAM_TOKEN_UNUSABLE_MESSAGE =
  'Token bot của tích hợp Telegram này không dùng được (khoá mã hoá đã đổi hoặc dữ liệu hỏng) — hãy xoá rồi thêm lại tích hợp với token mới, hoặc đặt khoá cũ vào INTEGRATION_ENCRYPTION_KEY_PREVIOUS rồi chạy integrations:rekey';

/** Không liên lạc được Telegram (mạng/timeout/5xx) — KHÁC với token sai. */
export class TelegramUnreachableError extends Error {
  constructor() {
    super('Không kết nối được tới Telegram');
    this.name = 'TelegramUnreachableError';
  }
}

export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
}

const GET_ME_TIMEOUT_MS = 8000;
/** Sau khi hỏi bot chung thất bại, không hỏi lại trong khoảng này (tránh dồn request mỗi lần mở danh sách). */
const GLOBAL_BOT_RETRY_MS = 30_000;

export type BotTokenResolution =
  | { kind: 'global' }
  | { kind: 'own'; token: string }
  | { kind: 'unusable' };

/**
 * Bot wrapper Telegram — degrade-graceful.
 * - KHÔNG launch polling; chỉ tạo Telegraf lazily theo token (cache theo token).
 * - Token cấu hình toàn cục (TELEGRAM_BOT_TOKEN) hoặc BYO (bring-your-own) theo integration.
 * - Thiếu token → mọi thao tác gửi trả về false (tính năng tắt), KHÔNG ném lỗi.
 * - Mã hóa botToken bằng AES-256-GCM; thiếu INTEGRATION_ENCRYPTION_KEY (>=32 ký tự) → encrypt() ném lỗi.
 * - Giải mã thử khoá hiện tại rồi INTEGRATION_ENCRYPTION_KEY_PREVIOUS; thất bại → null (không trả ciphertext).
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly globalBotToken: string;
  private readonly encryptionKey: string;
  /** Khoá cũ (optional) — chỉ để giải mã dữ liệu đã mã hoá trước khi đổi khoá, không bao giờ dùng để mã hoá. */
  private readonly previousKey: string;
  /** Cache Telegraf theo token để tái dùng (tránh tạo client mới mỗi lần gửi). */
  private readonly bots = new Map<string, Telegraf>();
  private globalBotInfo: TelegramBotInfo | null = null;
  private globalBotFailedAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SystemSettingsService,
  ) {
    const telegram = this.config.get<{ globalBotToken?: string }>('integrations.telegram');
    this.globalBotToken = telegram?.globalBotToken ?? '';
    this.encryptionKey = this.config.get<string>('integrations.encryptionKey') ?? '';
    this.previousKey = this.config.get<string>('integrations.encryptionKeyPrevious') ?? '';
  }

  /** Có bot khả dụng không (token truyền vào hoặc token toàn cục). */
  available(globalOrToken?: string | null): boolean {
    return Boolean(globalOrToken || this.globalBotToken);
  }

  /** Cờ hệ thống (kill-switch) cho phép tích hợp hoạt động. */
  platformEnabled(): boolean {
    return this.settings.flags().integrationsEnabled;
  }

  /**
   * Hỏi Telegram `getMe` để xác thực token. Trả thông tin bot; trả null khi Telegram từ chối token
   * (401/404); ném TelegramUnreachableError khi lỗi mạng/timeout/5xx (không kết luận được token sai).
   * KHÔNG ghi token vào log.
   */
  async getMe(token: string): Promise<TelegramBotInfo | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const bot = new Telegraf(token); // không cache: token chưa xác thực
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TelegramUnreachableError()), GET_ME_TIMEOUT_MS);
      });
      const me = await Promise.race([bot.telegram.getMe(), timeout]);
      return { id: me.id, username: me.username, firstName: me.first_name };
    } catch (err) {
      if (err instanceof TelegramError && (err.code === 401 || err.code === 404)) return null;
      if (err instanceof TelegramUnreachableError) throw err;
      this.logger.warn('Không gọi được getMe tới Telegram (lỗi mạng hoặc phản hồi bất thường)');
      throw new TelegramUnreachableError();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** @username của bot chung (TELEGRAM_BOT_TOKEN); null nếu chưa cấu hình hoặc chưa lấy được. Có cache. */
  async globalBotUsername(): Promise<string | null> {
    if (!this.globalBotToken) return null;
    if (this.globalBotInfo) return this.globalBotInfo.username;
    if (Date.now() - this.globalBotFailedAt < GLOBAL_BOT_RETRY_MS) return null;
    try {
      this.globalBotInfo = await this.getMe(this.globalBotToken);
      if (!this.globalBotInfo) this.globalBotFailedAt = Date.now();
    } catch {
      this.globalBotFailedAt = Date.now();
    }
    return this.globalBotInfo?.username ?? null;
  }

  /** Lấy (hoặc tạo & cache) Telegraf cho token. */
  private getBot(token: string): Telegraf {
    let bot = this.bots.get(token);
    if (!bot) {
      bot = new Telegraf(token);
      this.bots.set(token, bot);
    }
    return bot;
  }

  /**
   * Gửi tin nhắn HTML tới một chat Telegram.
   * - token: BYO token (đã giải mã) hoặc null → dùng token toàn cục.
   * - Thiếu token → trả false (disabled). Lỗi gửi → log warn + trả false (không ném).
   */
  async send(token: string | null, chatId: string, text: string): Promise<boolean> {
    // Admin có thể tắt toàn bộ tích hợp (kill-switch) — chặn mọi gửi đi.
    if (!this.settings.flags().integrationsEnabled) return false;
    const resolved = token || this.globalBotToken;
    if (!resolved) return false;
    try {
      const bot = this.getBot(resolved);
      await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
      return true;
    } catch (err) {
      this.logger.warn(
        `Không gửi được tin nhắn Telegram tới ${chatId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private hasKey(): boolean {
    return this.encryptionKey.length >= 32;
  }

  private static deriveKey(secret: string): Buffer {
    return crypto.createHash('sha256').update(secret).digest();
  }

  /** Mã hóa bot token (aes-256-gcm) → "iv:tag:ciphertext" hex. Không có key → ném lỗi (không bao giờ lưu plaintext). */
  encrypt(plain: string): string {
    if (!this.hasKey()) {
      throw new InternalServerErrorException(
        'Chưa cấu hình INTEGRATION_ENCRYPTION_KEY (tối thiểu 32 ký tự) — hãy đặt biến này rồi khởi động lại API',
      );
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      TelegramService.deriveKey(this.encryptionKey),
      iv,
    );
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  /** Thử giải mã bằng một khoá; sai khoá / dữ liệu hỏng → null. */
  private tryDecrypt(parts: [string, string, string], secret: string): string | null {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        TelegramService.deriveKey(secret),
        Buffer.from(parts[0], 'hex'),
      );
      decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(parts[2], 'hex')),
        decipher.final(),
      ]);
      return plain.toString('utf8');
    } catch {
      return null;
    }
  }

  /**
   * Giải mã token: thử khoá hiện tại rồi khoá cũ (INTEGRATION_ENCRYPTION_KEY_PREVIOUS).
   * - Chuỗi không có dạng "iv:tag:ciphertext" (dữ liệu cũ lưu plaintext) → trả nguyên.
   * - Có dạng ciphertext nhưng không khoá nào giải được → null + log lỗi; KHÔNG BAO GIỜ trả ciphertext làm token.
   */
  decrypt(enc: string): string | null {
    const parts = enc.split(':');
    if (parts.length !== 3) return enc;
    const triple = parts as [string, string, string];
    const keys = [this.encryptionKey, this.previousKey].filter((k) => k.length >= 32);
    for (const key of keys) {
      const plain = this.tryDecrypt(triple, key);
      if (plain !== null) return plain;
    }
    this.logger.error(
      'Không giải mã được bot token của tích hợp — khoá INTEGRATION_ENCRYPTION_KEY đã đổi? Đặt khoá cũ vào INTEGRATION_ENCRYPTION_KEY_PREVIOUS (xem docs/DEPLOY.md) hoặc nhập lại token trong Cài đặt → Tích hợp',
    );
    return null;
  }

  /** Phân biệt "không có token riêng" (dùng bot toàn cục) với "có token riêng nhưng hỏng" (KHÔNG được rơi về toàn cục). */
  resolveBotToken(config: Prisma.JsonValue): BotTokenResolution {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return { kind: 'global' };
    const botToken = (config as Record<string, unknown>).botToken;
    // Chỉ "chưa cấu hình" (undefined/null/'') mới dùng bot toàn cục; giá trị sai kiểu = dữ liệu hỏng.
    if (botToken === undefined || botToken === null || botToken === '') return { kind: 'global' };
    if (typeof botToken !== 'string') return { kind: 'unusable' };
    const token = this.decrypt(botToken);
    return token === null ? { kind: 'unusable' } : { kind: 'own', token };
  }
}
