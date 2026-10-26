import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorage } from './local-storage';
import { S3Storage } from './s3-storage';
import { StorageBootstrap, createObjectStorage } from './storage.module';

const cfg = (map: Record<string, unknown>) => ({ get: (k: string) => map[k] }) as never;

describe('createObjectStorage — chọn theo STORAGE_DRIVER', () => {
  it('local (mặc định) → LocalStorage', () => {
    expect(createObjectStorage(cfg({ 'storage.localDir': '/tmp/x' }))).toBeInstanceOf(LocalStorage);
    expect(createObjectStorage(cfg({}))).toBeInstanceOf(LocalStorage);
  });

  it('s3 → S3Storage với bucket đã cấu hình', () => {
    const s = createObjectStorage(
      cfg({
        'storage.driver': 's3',
        'storage.s3': {
          endpoint: 'http://127.0.0.1:9100',
          region: 'us-east-1',
          bucket: 'tirapro',
          accessKey: 'a',
          secretKey: 'b',
          forcePathStyle: true,
        },
      }),
    );
    expect(s).toBeInstanceOf(S3Storage);
    expect((s as S3Storage).bucket).toBe('tirapro');
  });
});

describe('StorageBootstrap — HeadBucket lúc khởi động', () => {
  afterEach(() => vi.restoreAllMocks());

  it('driver s3 thiếu bucket: log lỗi rõ, KHÔNG ném (không chặn khởi động), không tạo bucket', async () => {
    const err = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const storage = {
      driver: 's3',
      check: vi.fn(() => Promise.resolve({ ok: false, detail: 'Bucket "tirapro" không tồn tại' })),
    };
    await new StorageBootstrap(storage as never).onModuleInit();
    expect(storage.check).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toContain('tirapro');
  });

  it('s3 ổn → log thường, không error', async () => {
    const err = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const storage = { driver: 's3', bucket: 'tirapro', check: () => Promise.resolve({ ok: true }) };
    await new StorageBootstrap(storage as never).onModuleInit();
    expect(err).not.toHaveBeenCalled();
  });

  it('driver local: không gọi check', async () => {
    const storage = { driver: 'local', check: vi.fn() };
    await new StorageBootstrap(storage as never).onModuleInit();
    expect(storage.check).not.toHaveBeenCalled();
  });
});
