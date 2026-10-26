import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorage } from './local-storage';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage';
import { S3Storage, type S3StorageConfig } from './s3-storage';
import { StorageHealthService } from './storage-health.service';

/** Chọn cài đặt theo `STORAGE_DRIVER` (đã được `env.validation` bảo đảm đủ biến S3 khi là s3). */
export function createObjectStorage(config: ConfigService): ObjectStorage {
  if (config.get<string>('storage.driver') === 's3') {
    const s3 = config.get<S3StorageConfig>('storage.s3');
    if (!s3) throw new Error('Thiếu cấu hình storage.s3');
    return new S3Storage(s3);
  }
  return new LocalStorage(config.get<string>('storage.localDir') ?? './uploads');
}

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [ConfigService],
      useFactory: createObjectStorage,
    },
    StorageHealthService,
  ],
  exports: [OBJECT_STORAGE, StorageHealthService],
})
export class StorageModule {}
