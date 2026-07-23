import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { Telegraf } from 'telegraf';
import { SystemSettingsService } from '../system-settings/system-settings.service';

/**
 * Bot wrapper Telegram — degrade-graceful.
 * - KHÔNG launch polling; chỉ tạo Telegraf lazily theo token (cache theo token).
 * - Token cấu hình toàn cục (TELEGRAM_BOT_TOKEN) hoặc BYO (bring-your-own) theo integration.
 * - Thiếu token → mọi thao tác gửi trả về false (tính năng tắt), KHÔNG ném lỗi.
 * - Mã hóa botToken bằng AES-256-GCM nếu có INTEGRATION_ENCRYPTION_KEY (>=32 ký tự).
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly globalBotToken: string;
  private readonly encryptionKey: string;
  /** Cache Telegraf theo token để tái dùng (tránh tạo client mới mỗi lần gửi). */
  private readonly bots = new Map<string, Telegraf>();

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SystemSettingsService,
  ) {
    const telegram = this.config.get<{ globalBotToken?: string }>('integrations.telegram');
    this.globalBotToken = telegram?.globalBotToken ?? '';
    this.encryptionKey = this.config.get<string>('integrations.encryptionKey') ?? '';
  }

  /** Có bot khả dụng không (token truyền vào hoặc token toàn cục). */
  available(globalOrToken?: string | null): boolean {
    return Boolean(globalOrToken || this.globalBotToken);
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

  private deriveKey(): Buffer {
    return crypto.createHash('sha256').update(this.encryptionKey).digest();
  }

  /** Mã hóa bot token (aes-256-gcm) → "iv:tag:ciphertext" hex. Không có key → plaintext. */
  encrypt(plain: string): string {
    // TODO encrypt: thiếu INTEGRATION_ENCRYPTION_KEY (>=32 ký tự) → lưu plaintext.
    if (!this.hasKey()) return plain;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.deriveKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  /** Giải mã token. Không có key hoặc không đúng định dạng → trả nguyên (giả định plaintext). */
  decrypt(enc: string): string {
    // TODO encrypt: thiếu key → coi như plaintext.
    if (!this.hasKey()) return enc;
    const parts = enc.split(':');
    if (parts.length !== 3) return enc;
    try {
      const [ivHex, tagHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.deriveKey(),
        Buffer.from(ivHex, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(dataHex, 'hex')),
        decipher.final(),
      ]);
      return plain.toString('utf8');
    } catch (err) {
      this.logger.warn(
        `Không giải mã được bot token: ${err instanceof Error ? err.message : String(err)}`,
      );
      return enc;
    }
  }
}
