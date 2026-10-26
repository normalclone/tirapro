import { describe, expect, it } from 'vitest';
import { LocalStorage } from './local-storage';
import { S3Storage } from './s3-storage';
import { createObjectStorage } from './storage.module';

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
