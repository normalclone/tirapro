import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './memory-storage.testutil';
import { ObjectExistsError, type PutOptions, type StorageCheck } from './object-storage';
import { StorageHealthService } from './storage-health.service';

const cfg = (strict: boolean) =>
  ({ get: (k: string) => (k === 'storage.startupStrict' ? strict : undefined) }) as never;

/** Storage s3 giả: `results` là dãy kết quả check() lần lượt; probe chạy trên MemoryStorage bên dưới. */
function fakeS3(results: StorageCheck[], opts: { ignoreConditional?: boolean } = {}) {
  let i = 0;
  class FakeS3 extends MemoryStorage {
    override readonly driver = 's3' as const;
    readonly bucket = 'tirapro';
    override check = vi.fn(() =>
      Promise.resolve(results[Math.min(i++, results.length - 1)] as StorageCheck),
    );
    destroy = vi.fn();
    override put(key: string, body: Buffer, o: PutOptions = {}) {
      return super.put(key, body, opts.ignoreConditional ? { ...o, ifNotExists: false } : o);
    }
  }
  return new FakeS3();
}

describe('StorageHealthService — khởi động', () => {
  let err: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    err = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('driver local: không gọi check, không hẹn giờ', async () => {
    const storage = { driver: 'local', check: vi.fn() };
    const h = new StorageHealthService(storage as never, cfg(true));
    await h.onModuleInit();
    expect(storage.check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('s3 ổn: log sẵn sàng, không error', async () => {
    const h = new StorageHealthService(fakeS3([{ ok: true }]), cfg(true));
    await h.onModuleInit();
    expect(log).toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('strict + lỗi cấu hình dứt khoát (bucket thiếu/403/khoá sai) → NÉM lỗi tiếng Việt rõ (fail-fast)', async () => {
    const s = fakeS3([
      { ok: false, kind: 'config', detail: 'Bucket "tirapro" không tồn tại — hãy tạo bucket' },
    ]);
    const h = new StorageHealthService(s, cfg(true));
    await expect(h.onModuleInit()).rejects.toThrow(
      /Bucket "tirapro" không tồn tại[\s\S]*STORAGE_STARTUP_STRICT/,
    );
  });

  it('không strict + lỗi cấu hình: chỉ log error, vẫn khởi động, tiếp tục thử lại', async () => {
    const s = fakeS3([{ ok: false, kind: 'config', detail: 'sai quyền' }]);
    const h = new StorageHealthService(s, cfg(false));
    await expect(h.onModuleInit()).resolves.toBeUndefined();
    expect(String(err.mock.calls[0]?.[0])).toContain('sai quyền');
    expect(vi.getTimerCount()).toBe(1);
    h.onModuleDestroy();
  });

  it('strict + lỗi mạng: KHÔNG ném, khởi động, thử lại HeadBucket mỗi 30 giây, báo khi phục hồi', async () => {
    const s = fakeS3([
      { ok: false, kind: 'network', detail: 'không kết nối được' },
      { ok: false, kind: 'network', detail: 'không kết nối được' },
      { ok: true },
    ]);
    const h = new StorageHealthService(s, cfg(true));
    const recovered = vi.fn();
    h.onRecovered(recovered);
    await h.onModuleInit();
    expect(s.check).toHaveBeenCalledTimes(1);
    expect(recovered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.check).toHaveBeenCalledTimes(2);
    expect(recovered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.check).toHaveBeenCalledTimes(3);
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0); // hết lỗi → dừng hẹn giờ
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.check).toHaveBeenCalledTimes(3);
  });

  it('probe: máy chủ TÔN TRỌNG ghi có điều kiện → không error; probe được dọn', async () => {
    const s = fakeS3([{ ok: true }]);
    await new StorageHealthService(s, cfg(true)).onModuleInit();
    expect(err).not.toHaveBeenCalled();
    expect([...s.files.keys()].filter((k) => k.startsWith('.probe/'))).toEqual([]);
  });

  it('probe: máy chủ BỎ QUA ghi có điều kiện → log error rõ (DB claim vẫn bảo vệ), vẫn khởi động, probe được dọn', async () => {
    const s = fakeS3([{ ok: true }], { ignoreConditional: true });
    await new StorageHealthService(s, cfg(true)).onModuleInit();
    const msg = err.mock.calls.map((c) => String(c[0])).join('\n');
    expect(msg).toMatch(/ghi có điều kiện|If-None-Match/);
    expect(msg).toMatch(/DB/);
    expect([...s.files.keys()].filter((k) => k.startsWith('.probe/'))).toEqual([]);
  });

  it('probe dùng đúng ObjectExistsError của lớp lưu trữ (lần hai bị từ chối)', async () => {
    const s = fakeS3([{ ok: true }]);
    await s.put('.probe/x', Buffer.from('1'), { ifNotExists: true });
    await expect(s.put('.probe/x', Buffer.from('1'), { ifNotExists: true })).rejects.toBeInstanceOf(
      ObjectExistsError,
    );
  });

  it('M4: cachedCheck dùng lại kết quả trong 30 giây rồi kiểm lại', async () => {
    const s = fakeS3([{ ok: true }, { ok: false, kind: 'network', detail: 'x' }]);
    const h = new StorageHealthService(s, cfg(false));
    expect((await h.cachedCheck()).ok).toBe(true);
    expect((await h.cachedCheck()).ok).toBe(true);
    expect(s.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect((await h.cachedCheck()).ok).toBe(false);
    expect(s.check).toHaveBeenCalledTimes(2);
  });

  it('M7: onModuleDestroy huỷ hẹn giờ và gọi storage.destroy()', async () => {
    const s = fakeS3([{ ok: false, kind: 'network', detail: 'x' }]);
    const h = new StorageHealthService(s, cfg(false));
    await h.onModuleInit();
    h.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(s.destroy).toHaveBeenCalled();
  });
});
