import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ResilientThrottlerStorage } from './resilient-throttler-storage';

Logger.overrideLogger(false);

const record = { totalHits: 7, timeToExpire: 1000, isBlocked: false, timeToBlockExpire: 0 };

describe('ResilientThrottlerStorage', () => {
  it('Redis sẵn sàng → dùng Redis', async () => {
    const redis = { increment: vi.fn().mockResolvedValue(record) };
    const s = new ResilientThrottlerStorage(redis, () => true);
    expect(await s.increment('k', 1000, 5, 0, 'default')).toEqual(record);
    expect(redis.increment).toHaveBeenCalledOnce();
    s.onApplicationShutdown();
  });

  it('Redis lỗi → rơi về bộ nhớ, không ném lỗi', async () => {
    const redis = { increment: vi.fn().mockRejectedValue(new Error('down')) };
    const s = new ResilientThrottlerStorage(redis, () => true);
    const r = await s.increment('k', 1000, 5, 0, 'default');
    expect(r.totalHits).toBe(1);
    expect((await s.increment('k', 1000, 5, 0, 'default')).totalHits).toBe(2);
    s.onApplicationShutdown();
  });

  it('không có Redis → bộ nhớ, không gọi Redis', async () => {
    const redis = { increment: vi.fn() };
    const s = new ResilientThrottlerStorage(redis, () => false);
    expect((await s.increment('k', 1000, 5, 0, 'default')).totalHits).toBe(1);
    expect(redis.increment).not.toHaveBeenCalled();
    const none = new ResilientThrottlerStorage(null, () => true);
    expect((await none.increment('k', 1000, 5, 0, 'default')).totalHits).toBe(1);
    s.onApplicationShutdown();
    none.onApplicationShutdown();
  });

  it('cảnh báo một lần mỗi đợt sự cố: Redis phục hồi rồi lỗi lại thì log lại', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const redis = {
      increment: vi
        .fn()
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce(record)
        .mockRejectedValueOnce(new Error('down again')),
    };
    const s = new ResilientThrottlerStorage(redis, () => true);
    await s.increment('k', 1000, 5, 0, 'default');
    await s.increment('k', 1000, 5, 0, 'default');
    expect(warn).toHaveBeenCalledTimes(1);
    await s.increment('k', 1000, 5, 0, 'default'); // Redis phục hồi
    await s.increment('k', 1000, 5, 0, 'default'); // đợt sự cố thứ hai
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    s.onApplicationShutdown();
  });
});
