import { describe, expect, it, vi } from 'vitest';
import { AdminOverviewService } from './admin-overview.service';

function make(
  cfg: Record<string, unknown>,
  check: () => Promise<{ ok: boolean; detail?: string }>,
) {
  const config = { get: (k: string) => cfg[k] };
  const prisma = { $queryRaw: vi.fn(() => Promise.resolve([{ '?column?': 1 }])) };
  const redis = { isAvailable: () => true };
  const settings = { flags: () => ({ aiKillSwitch: false }) };
  const storage = { driver: cfg['storage.driver'] ?? 'local', check: vi.fn(check) };
  const svc = new AdminOverviewService(
    prisma as never,
    config as never,
    redis as never,
    settings as never,
    storage as never,
  );
  return { svc, storage };
}

describe('AdminOverviewService — trạng thái lưu trữ', () => {
  it('local: storage=true, không có bucket, không gọi check', async () => {
    const { svc, storage } = make({ 'storage.driver': 'local' }, () =>
      Promise.resolve({ ok: true }),
    );
    const d = await svc.degrade();
    expect(d).toMatchObject({ storage: true, storageDriver: 'local', storageBucket: null });
    expect(storage.check).not.toHaveBeenCalled();
  });

  it('s3 ổn: hiện driver + bucket, storage=true', async () => {
    const { svc } = make({ 'storage.driver': 's3', 'storage.s3.bucket': 'tirapro' }, () =>
      Promise.resolve({ ok: true }),
    );
    expect(await svc.degrade()).toMatchObject({
      storage: true,
      storageDriver: 's3',
      storageBucket: 'tirapro',
    });
  });

  it('s3 HeadBucket lỗi: storage=false (hiện đỏ trên console)', async () => {
    const { svc } = make({ 'storage.driver': 's3', 'storage.s3.bucket': 'tirapro' }, () =>
      Promise.resolve({ ok: false, detail: 'Bucket không tồn tại' }),
    );
    expect((await svc.degrade()).storage).toBe(false);
  });

  it('configStatus: lộ driver + bucket, TUYỆT ĐỐI không lộ khoá/endpoint', () => {
    const { svc } = make(
      {
        'storage.driver': 's3',
        'storage.s3.bucket': 'tirapro',
        'storage.s3.accessKey': 'AKIA-LEAK',
        'storage.s3.secretKey': 'SECRET-LEAK',
        'storage.maxFileSizeMb': 25,
      },
      () => Promise.resolve({ ok: true }),
    );
    const st = svc.configStatus();
    expect(st.storage).toEqual({ driver: 's3', maxFileSizeMb: 25, s3Bucket: 'tirapro' });
    expect(JSON.stringify(st)).not.toMatch(/LEAK/);
  });
});
