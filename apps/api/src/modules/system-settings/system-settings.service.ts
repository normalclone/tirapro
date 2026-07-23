import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

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
 * Lưu cờ hệ thống ra file JSON (degrade-graceful, không cần migration).
 * Đọc 1 lần lúc khởi động vào cache, ghi xuyên (write-through) khi cập nhật.
 */
@Injectable()
export class SystemSettingsService implements OnModuleInit {
  private readonly logger = new Logger(SystemSettingsService.name);
  private cache: SystemFlags = { ...DEFAULTS };
  private readonly file: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const dir = config.get<string>('storage.localDir') ?? './var/storage';
    this.file = join(dir, 'system-settings.json');
  }

  async onModuleInit(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      this.cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SystemFlags>) };
    } catch {
      // Chưa có file → dùng mặc định (bình thường ở lần chạy đầu).
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
    if (typeof patch.integrationsEnabled === 'boolean') next.integrationsEnabled = patch.integrationsEnabled;
    if (typeof patch.maintenanceBanner === 'string') next.maintenanceBanner = patch.maintenanceBanner.slice(0, 500);
    this.cache = next;
    try {
      await fs.mkdir(dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(next, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn(`Không ghi được system-settings.json: ${(err as Error).message}`);
    }
    return next;
  }
}
