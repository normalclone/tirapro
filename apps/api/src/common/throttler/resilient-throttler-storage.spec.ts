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
});
