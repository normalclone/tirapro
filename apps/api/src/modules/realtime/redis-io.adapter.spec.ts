import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../infra/redis/redis.service';
import { RedisIoAdapter, buildSocketCors } from './redis-io.adapter';

function makeAdapter(opts: { useRedisAdapter: boolean; available: boolean }) {
  const pubSub = () => ({ on: vi.fn() });
  const redis = {
    isAvailable: vi.fn().mockReturnValue(opts.available),
    duplicate: vi.fn().mockImplementation(pubSub),
  };
  const config = {
    get: vi.fn((key: string) => (key === 'ws.useRedisAdapter' ? opts.useRedisAdapter : undefined)),
  };
  const app = {
    get: (token: unknown) => (token === ConfigService ? config : token === RedisService ? redis : undefined),
    getHttpServer: () => ({}),
  };
  return { adapter: new RedisIoAdapter(app as never), redis };
}

describe('buildSocketCors', () => {
  it('dùng đúng danh sách origin từ config và bật credentials', () => {
    expect(buildSocketCors(['http://a.test', 'http://b.test'])).toEqual({
      origin: ['http://a.test', 'http://b.test'],
      credentials: true,
    });
  });

  it('không có origin cấu hình thì từ chối mọi origin chéo (không mở toang)', () => {
    expect(buildSocketCors(undefined)).toEqual({ origin: false, credentials: true });
    expect(buildSocketCors([])).toEqual({ origin: false, credentials: true });
  });
});

describe('RedisIoAdapter.connectToRedis', () => {
  it('không bật khi config tắt useRedisAdapter', async () => {
    const { adapter, redis } = makeAdapter({ useRedisAdapter: false, available: true });
    expect(await adapter.connectToRedis(0)).toBe(false);
    expect(redis.duplicate).not.toHaveBeenCalled();
  });

  it('giảm cấp về in-memory khi Redis không sẵn sàng', async () => {
    const { adapter, redis } = makeAdapter({ useRedisAdapter: true, available: false });
    expect(await adapter.connectToRedis(0)).toBe(false);
    expect(redis.duplicate).not.toHaveBeenCalled();
  });

  it('bật adapter với hai client pub/sub riêng khi Redis sẵn sàng', async () => {
    const { adapter, redis } = makeAdapter({ useRedisAdapter: true, available: true });
    expect(await adapter.connectToRedis(0)).toBe(true);
    expect(redis.duplicate).toHaveBeenCalledTimes(2);
  });
});
