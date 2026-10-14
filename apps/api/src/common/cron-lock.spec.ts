/* eslint-disable @typescript-eslint/require-await -- mock bất đồng bộ phải trả Promise dù không await */
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCronLockWarning, withCronLock, type CronLockClient, type CronLockRedis } from './cron-lock';

Logger.overrideLogger(false);

/** Redis giả đủ dùng cho SET NX EX + script nhả khoá (get/del so khớp giá trị). */
class FakeRedis implements CronLockRedis, CronLockClient {
  store = new Map<string, string>();
  ttl = new Map<string, number>();
  available = true;
  failSet = false;

  isAvailable() {
    return this.available;
  }
  getClient() {
    return this.available ? this : null;
  }
  async set(key: string, value: string, _m: 'EX', ttlSec: number, _f: 'NX') {
    if (this.failSet) throw new Error('boom');
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    this.ttl.set(key, ttlSec);
    return 'OK' as const;
  }
  async eval(_script: string, _n: number, key: string, token: string) {
    if (this.store.get(key) === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

describe('withCronLock', () => {
  beforeEach(() => resetCronLockWarning());

  it('lấy được khoá → chạy fn rồi nhả khoá', async () => {
    const redis = new FakeRedis();
    const fn = vi.fn(async () => {
      expect(redis.store.get('lock:cron:job')).toBeTruthy();
      expect(redis.ttl.get('lock:cron:job')).toBe(30);
    });
    expect(await withCronLock(redis, 'job', 30, fn)).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(redis.store.size).toBe(0);
  });

  it('khoá đang bị giữ → bỏ qua, không chạy fn và không xoá khoá của node khác', async () => {
    const redis = new FakeRedis();
    redis.store.set('lock:cron:job', 'node-khac');
    const fn = vi.fn(async () => undefined);
    expect(await withCronLock(redis, 'job', 30, fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(redis.store.get('lock:cron:job')).toBe('node-khac');
  });

  it('hai lần chạy chồng nhau chỉ một lần được chạy', async () => {
    const redis = new FakeRedis();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = vi.fn(() => gate);
    const first = withCronLock(redis, 'job', 30, fn);
    await Promise.resolve();
    expect(await withCronLock(redis, 'job', 30, fn)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('fn ném lỗi → vẫn nhả khoá và ném lại lỗi', async () => {
    const redis = new FakeRedis();
    await expect(
      withCronLock(redis, 'job', 30, async () => {
        throw new Error('hỏng');
      }),
    ).rejects.toThrow('hỏng');
    expect(redis.store.size).toBe(0);
  });

  it('không nhả khoá nếu khoá đã bị node khác chiếm (TTL hết hạn giữa chừng)', async () => {
    const redis = new FakeRedis();
    await withCronLock(redis, 'job', 30, async () => {
      redis.store.set('lock:cron:job', 'node-khac');
    });
    expect(redis.store.get('lock:cron:job')).toBe('node-khac');
  });

  it('không có Redis → chạy fn trực tiếp', async () => {
    const redis = new FakeRedis();
    redis.available = false;
    const fn = vi.fn(async () => undefined);
    expect(await withCronLock(redis, 'job', 30, fn)).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('Redis lỗi lúc SET → chạy fn trực tiếp', async () => {
    const redis = new FakeRedis();
    redis.failSet = true;
    const fn = vi.fn(async () => undefined);
    expect(await withCronLock(redis, 'job', 30, fn)).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });
});
