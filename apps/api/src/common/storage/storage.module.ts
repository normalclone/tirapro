import { Global, Inject, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorage } from './local-storage';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage';
import { S3Storage, type S3StorageConfig } from './s3-storage';

/** Chọn cài đặt theo `STORAGE_DRIVER` (đã được `env.validation` bảo đảm đủ biến S3 khi là s3). */
export function createObjectStorage(config: ConfigService): ObjectStorage {
  if (config.get<string>('storage.driver') === 's3') {
    const s3 = config.get<S3StorageConfig>('storage.s3');
    if (!s3) throw new Error('Thiếu cấu hình storage.s3');
    return new S3Storage(s3);
  }
  return new LocalStorage(config.get<string>('storage.localDir') ?? './uploads');
}

/** Lúc khởi động với driver s3: HeadBucket. Lỗi chỉ được LOG (không chặn khởi động, không tự tạo bucket). */
@Injectable()
export class StorageBootstrap implements OnModuleInit {
  private readonly logger = new Logger('Storage');

  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  async onModuleInit(): Promise<void> {
    if (this.storage.driver !== 's3') return;
    const res = await this.storage.check();
    if (res.ok) {
      this.logger.log(`S3 sẵn sàng: bucket "${(this.storage as S3Storage).bucket}" truy cập được`);
    } else {
      this.logger.error(`Kho tệp S3 KHÔNG dùng được: ${res.detail ?? 'không rõ nguyên nhân'}`);
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [ConfigService],
      useFactory: createObjectStorage,
    },
    StorageBootstrap,
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
