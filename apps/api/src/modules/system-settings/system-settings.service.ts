import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ObjectNotFoundError,
  OBJECT_STORAGE,
  causeMessage,
  streamToBuffer,
  type ObjectStorage,
} from '../../common/storage/object-storage';

/** Khoá lưu trữ của tệp cờ (local: `{STORAGE_LOCAL_DIR}/system-settings.json`). */
const SETTINGS_KEY = 'system-settings.json';

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

/**
 * Lưu cờ hệ thống thành một tệp JSON qua ObjectStorage (degrade-graceful, không cần migration).
 * Đọc 1 lần lúc khởi động vào cache, ghi xuyên (write-through) khi cập nhật.
 */
@Injectable()
export class SystemSettingsService implements OnModuleInit {
  private readonly logger = new Logger(SystemSettingsService.name);
  private cache: SystemFlags = { ...DEFAULTS };

  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  async onModuleInit(): Promise<void> {
    try {
      const { stream } = await this.storage.get(SETTINGS_KEY);
      const raw = (await streamToBuffer(stream)).toString('utf8');
      this.cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SystemFlags>) };
    } catch (err) {
      // Chưa có tệp → dùng mặc định (bình thường ở lần chạy đầu); lỗi khác chỉ cảnh báo, vẫn chạy với mặc định.
      if (!(err instanceof ObjectNotFoundError))
        this.logger.warn(`Không đọc được ${SETTINGS_KEY}, dùng mặc định: ${causeMessage(err)}`);
    }
  }

  /** Cờ hiện hành (đồng bộ, đọc từ cache). */
  flags(): SystemFlags {
    return this.cache;
  }

  /** Cập nhật một phần cờ; ghi xuống file; trả về trạng thái mới. */
  async setFlags(patch: Partial<SystemFlags>): Promise<SystemFlags> {
    const next: SystemFlags = { ...this.cache };
    if (typeof patch.signupEnabled === 'boolean') next.signupEnabled = patch.signupEnabled;
    if (typeof patch.aiKillSwitch === 'boolean') next.aiKillSwitch = patch.aiKillSwitch;
    if (typeof patch.integrationsEnabled === 'boolean')
      next.integrationsEnabled = patch.integrationsEnabled;
    if (typeof patch.maintenanceBanner === 'string')
      next.maintenanceBanner = patch.maintenanceBanner.slice(0, 500);
    this.cache = next;
    try {
      await this.storage.put(SETTINGS_KEY, Buffer.from(JSON.stringify(next, null, 2), 'utf8'), {
        contentType: 'application/json',
      });
    } catch (err) {
      this.logger.warn(`Không ghi được ${SETTINGS_KEY}: ${causeMessage(err)}`);
    }
    return next;
  }
}
