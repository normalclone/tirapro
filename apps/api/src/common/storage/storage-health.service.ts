import { randomBytes } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OBJECT_STORAGE,
  ObjectExistsError,
  causeMessage,
  type ObjectStorage,
  type StorageCheck,
} from './object-storage';

const RECHECK_MS = 30_000;
const CACHE_MS = 30_000;

/**
 * Sức khoẻ kho lưu trữ (S3): HeadBucket lúc khởi động, thử lại định kỳ khi lỗi, kết quả có nhớ cho console admin.
 *
 * - Lỗi CẤU HÌNH dứt khoát (bucket thiếu, 403, khoá sai): `STORAGE_STARTUP_STRICT` (mặc định true ở production) ⇒ NÉM lỗi để
 *   tiến trình dừng ngay với thông báo rõ; không strict ⇒ chỉ log.
 * - Lỗi MẠNG/timeout: luôn cho API khởi động, thử lại HeadBucket mỗi 30 giây, log khi kho sống lại (cờ hệ thống tự đọc lại bằng backoff riêng của SystemSettingsService).
 * - Probe ghi có điều kiện (`If-None-Match: *`): máy chủ S3 bỏ qua header ⇒ log lỗi rõ (claim import Jira ở DB vẫn bảo vệ).
 */
@Injectable()
export class StorageHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Storage');
  private readonly strict: boolean;
  private timer: NodeJS.Timeout | null = null;
  private cache: { at: number; result: StorageCheck } | null = null;
  private lastDetail = '';

  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    config: ConfigService,
  ) {
    this.strict = config.get<boolean>('storage.startupStrict') ?? false;
  }

  async onModuleInit(): Promise<void> {
    if (this.storage.driver !== 's3') return;
    const res = await this.check();
    if (res.ok) {
      this.logger.log(`S3 sẵn sàng: bucket "${this.bucketName()}" truy cập được`);
      if (res.note) this.logger.warn(res.note);
      await this.probeConditionalWrites();
      return;
    }
    const detail = res.detail ?? 'không rõ nguyên nhân';
    if (res.kind === 'config' && this.strict) {
      throw new Error(
        `❌ Kho tệp S3 cấu hình sai, dừng khởi động: ${detail} (chữa cháy: đặt STORAGE_STARTUP_STRICT=false để vẫn khởi động, nhưng upload/tải tệp sẽ lỗi).`,
      );
    }
    this.logger.error(
      res.kind === 'config'
        ? `Kho tệp S3 KHÔNG dùng được (cấu hình sai): ${detail}`
        : `Kho tệp S3 KHÔNG dùng được lúc này (API vẫn khởi động, thử lại mỗi 30 giây): ${detail}`,
    );
    this.lastDetail = detail;
    this.startRecheck();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.storage.destroy?.();
  }

  /** HeadBucket thật (không nhớ). */
  async check(): Promise<StorageCheck> {
    const result = await this.storage.check();
    this.cache = { at: Date.now(), result };
    return result;
  }

  /** Kết quả HeadBucket có nhớ ~30 giây — cho trang tổng quan admin (tránh chờ timeout mỗi lần mở trang). */
  async cachedCheck(): Promise<StorageCheck> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.result;
    return this.check();
  }

  private bucketName(): string {
    const { bucket = '', keyPrefix = '' } = this.storage as { bucket?: string; keyPrefix?: string };
    return keyPrefix ? `${bucket}" (tiền tố "${keyPrefix}` : bucket;
  }

  private startRecheck(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.recheck(), RECHECK_MS);
    this.timer.unref();
  }

  private async recheck(): Promise<void> {
    const res = await this.check();
    if (res.ok) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.logger.log(`Kho tệp S3 đã phục hồi: bucket "${this.bucketName()}" truy cập được`);
      await this.probeConditionalWrites();
    } else if (res.detail && res.detail !== this.lastDetail) {
      this.lastDetail = res.detail;
      this.logger.error(`Kho tệp S3 vẫn lỗi: ${res.detail}`);
    }
  }

  /** Ghi cùng một khoá thăm dò hai lần với `ifNotExists`: lần hai PHẢI bị từ chối. */
  private async probeConditionalWrites(): Promise<void> {
    const key = `.probe/${randomBytes(8).toString('hex')}`;
    try {
      await this.storage.put(key, Buffer.from('probe'), { ifNotExists: true });
      try {
        await this.storage.put(key, Buffer.from('probe'), { ifNotExists: true });
        this.logger.error(
          'Máy chủ S3 BỎ QUA ghi có điều kiện (If-None-Match: *) — lớp phụ chống chạy trùng bằng object không còn tác dụng. ' +
            'Claim import Jira ở DB vẫn bảo vệ (advisory lock + ImportJob); nên nâng cấp MinIO/S3 lên bản hỗ trợ ghi có điều kiện.',
        );
      } catch (err) {
        if (!(err instanceof ObjectExistsError)) throw err; // đúng kỳ vọng: bị từ chối
      }
    } catch (err) {
      this.logger.warn(`Không chạy được thăm dò ghi có điều kiện: ${causeMessage(err)}`);
    } finally {
      await this.storage.delete(key).catch(() => undefined);
    }
  }
}
