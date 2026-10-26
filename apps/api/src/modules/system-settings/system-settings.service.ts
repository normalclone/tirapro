import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import {
  ObjectNotFoundError,
  OBJECT_STORAGE,
  causeMessage,
  streamToBuffer,
  type ObjectStorage,
} from '../../common/storage/object-storage';

/** Khoá lưu trữ của tệp cờ (local: `{STORAGE_LOCAL_DIR}/system-settings.json`). */
const SETTINGS_KEY = 'system-settings.json';
/** Đọc lại khi kho lưu trữ lỗi: 2s, 4s, 8s, … trần 30s. */
const RETRY_FIRST_MS = 2_000;
const RETRY_MAX_MS = 30_000;

/** Cờ cấu hình runtime cấp hệ thống — admin bật/tắt, không cần deploy lại. */
export interface SystemFlags {
  /** Cho phép đăng ký công khai (self-signup). */
  signupEnabled: boolean;
  /** Tắt khẩn cấp toàn bộ AI (dù đã cấu hình key) → rơi về heuristic. */
  aiKillSwitch: boolean;
  /** Bật/tắt các tích hợp ngoài (Telegram, dev links…). */
  integrationsEnabled: boolean;
  /** Banner bảo trì hiển thị cho mọi người (rỗng = ẩn). */
  maintenanceBanner: string;
}

const DEFAULTS: SystemFlags = {
  signupEnabled: true,
  aiKillSwitch: false,
  integrationsEnabled: true,
  maintenanceBanner: '',
};

/** Mặc định AN TOÀN khi chưa đọc được cờ thật (kho lưu trữ lỗi): đóng đăng ký công khai, còn lại như mặc định. */
const SAFE_UNLOADED: SystemFlags = { ...DEFAULTS, signupEnabled: false };

const unavailable = (message: string) =>
  new AppException('STORAGE_UNAVAILABLE', message, HttpStatus.SERVICE_UNAVAILABLE);

/**
 * Lưu cờ hệ thống thành một tệp JSON qua ObjectStorage (degrade-graceful, không cần migration).
 * Đọc vào cache lúc khởi động, ghi xuyên (write-through) khi cập nhật.
 *
 * Phân biệt hai trường hợp khi đọc:
 * - KHÔNG CÓ TỆP: bình thường (lần chạy đầu) → dùng mặc định, coi như đã nạp.
 * - ĐỌC LỖI (S3 chưa sẵn sàng…): `loaded=false`, dùng mặc định an toàn (đóng đăng ký), tự thử lại có backoff; trong lúc đó
 *   `setFlags` TỪ CHỐI (không bao giờ ghi đè cờ thật bằng "mặc định + patch").
 */
@Injectable()
export class SystemSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemSettingsService.name);
  private cache: SystemFlags = { ...DEFAULTS };
  private loaded = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelay = RETRY_FIRST_MS;

  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  onModuleDestroy(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Đã đọc được cờ thật (hoặc xác nhận chưa có tệp) chưa. */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Cờ hiện hành (đồng bộ, đọc từ cache). */
  flags(): SystemFlags {
    return this.cache;
  }

  /** Cập nhật một phần cờ; ghi xuống kho; trả về trạng thái mới. Ném lỗi (503) nếu không đọc/ghi được. */
  async setFlags(patch: Partial<SystemFlags>): Promise<SystemFlags> {
    if (!this.loaded && !(await this.reload())) {
      throw unavailable(
        'Chưa đọc được cờ hệ thống từ kho lưu trữ nên chưa thể lưu thay đổi (để không ghi đè cờ hiện có) — thử lại sau ít phút.',
      );
    }
    const next: SystemFlags = { ...this.cache };
    if (typeof patch.signupEnabled === 'boolean') next.signupEnabled = patch.signupEnabled;
    if (typeof patch.aiKillSwitch === 'boolean') next.aiKillSwitch = patch.aiKillSwitch;
    if (typeof patch.integrationsEnabled === 'boolean')
      next.integrationsEnabled = patch.integrationsEnabled;
    if (typeof patch.maintenanceBanner === 'string')
      next.maintenanceBanner = patch.maintenanceBanner.slice(0, 500);
    try {
      await this.storage.put(SETTINGS_KEY, Buffer.from(JSON.stringify(next, null, 2), 'utf8'), {
        contentType: 'application/json',
      });
    } catch (err) {
      this.logger.error(`Không ghi được ${SETTINGS_KEY}: ${causeMessage(err)}`);
      throw unavailable('Không lưu được cờ hệ thống, thử lại.');
    }
    this.cache = next;
    return next;
  }

  /** Đọc cờ từ kho. true = đã có trạng thái xác định (có tệp hoặc xác nhận chưa có tệp). */
  private async reload(): Promise<boolean> {
    try {
      const { stream } = await this.storage.get(SETTINGS_KEY);
      const raw = (await streamToBuffer(stream)).toString('utf8');
      try {
        this.cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SystemFlags>) };
      } catch {
        this.logger.error(
          `${SETTINGS_KEY} hỏng (không phải JSON) — dùng mặc định; lưu cờ mới sẽ ghi đè tệp hỏng`,
        );
        this.cache = { ...DEFAULTS };
      }
      return this.markLoaded();
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        this.cache = { ...DEFAULTS }; // chưa có tệp = bình thường ở lần chạy đầu
        return this.markLoaded();
      }
      this.logger.warn(
        `Không đọc được ${SETTINGS_KEY} (sẽ thử lại sau ${this.retryDelay / 1000}s): ${causeMessage(err)}`,
      );
      if (!this.loaded) this.cache = { ...SAFE_UNLOADED };
      this.scheduleRetry();
      return false;
    }
  }

  private markLoaded(): true {
    this.loaded = true;
    this.retryDelay = RETRY_FIRST_MS;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    return true;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.reload();
    }, delay);
    this.retryTimer.unref();
  }
}
