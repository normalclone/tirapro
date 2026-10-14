import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { RedisService } from '../../infra/redis/redis.service';
import { RedisIoAdapter, buildSocketCors, pubSubRetryStrategy } from './redis-io.adapter';

type FakeClient = {
  status: string;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function fakeClient(status = 'ready'): FakeClient {
  return { status, on: vi.fn(), once: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
}

function makeAdapter(opts: { useRedisAdapter: boolean; available: boolean; clientStatus?: string }) {
  const clients: FakeClient[] = [];
  const redis = {
    isAvailable: vi.fn().mockReturnValue(opts.available),
    duplicate: vi.fn().mockImplementation(() => {
      const c = fakeClient(opts.clientStatus);
      clients.push(c);
      return c;
    }),
  };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'ws.useRedisAdapter') return opts.useRedisAdapter;
      if (key === 'api.corsOrigin') return ['http://a.test'];
      return undefined;
    }),
  };
  const app = {
    get: (token: unknown) => (token === ConfigService ? config : token === RedisService ? redis : undefined),
    getHttpServer: () => ({}),
  };
  return { adapter: new RedisIoAdapter(app as never), redis, clients };
}

afterEach(() => vi.restoreAllMocks());

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

  it('bật adapter với hai client pub/sub riêng, bật lại offline queue', async () => {
    const { adapter, redis } = makeAdapter({ useRedisAdapter: true, available: true });
    expect(await adapter.connectToRedis(0)).toBe(true);
    expect(redis.duplicate).toHaveBeenCalledTimes(2);
    expect(redis.duplicate).toHaveBeenCalledWith({ enableOfflineQueue: true, retryStrategy: pubSubRetryStrategy });
  });

  it('retryStrategy của pub/sub không bao giờ trả null (backoff trần 10 giây)', () => {
    expect(pubSubRetryStrategy(1)).toBe(200);
    expect(pubSubRetryStrategy(5)).toBe(1000);
    expect(pubSubRetryStrategy(6)).toBe(1200);
    expect(pubSubRetryStrategy(1000)).toBe(10_000);
  });

  it('client pub/sub chưa kịp ready thì đóng chúng và giảm cấp về in-memory', async () => {
    const { adapter, clients } = makeAdapter({ useRedisAdapter: true, available: true, clientStatus: 'connecting' });
    expect(await adapter.connectToRedis(10)).toBe(false);
    expect(clients).toHaveLength(2);
    for (const c of clients) expect(c.disconnect).toHaveBeenCalledTimes(1);
  });

  it('dispose đóng hai client pub/sub', async () => {
    const { adapter, clients } = makeAdapter({ useRedisAdapter: true, available: true });
    await adapter.connectToRedis(0);
    await adapter.dispose();
    for (const c of clients) expect(c.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('RedisIoAdapter.createIOServer', () => {
  it('ép CORS theo config và gắn Redis adapter khi đã bật', async () => {
    const server = { adapter: vi.fn() };
    const base = vi.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server);
    const { adapter } = makeAdapter({ useRedisAdapter: true, available: true });
    await adapter.connectToRedis(0);

    const result = adapter.createIOServer(4000, { path: '/realtime', cors: { origin: true } } as never);

    expect(result).toBe(server);
    expect(base).toHaveBeenCalledWith(
      4000,
      expect.objectContaining({
        path: '/realtime',
        cors: { origin: ['http://a.test'], credentials: true },
      }),
    );
    expect(server.adapter).toHaveBeenCalledTimes(1);
  });

  it('không gọi server.adapter khi chạy in-memory nhưng vẫn áp CORS', () => {
    const server = { adapter: vi.fn() };
    const base = vi.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server);
    const { adapter } = makeAdapter({ useRedisAdapter: false, available: false });

    adapter.createIOServer(4000, { path: '/realtime' } as never);

    expect(base).toHaveBeenCalledWith(
      4000,
      expect.objectContaining({ cors: { origin: ['http://a.test'], credentials: true } }),
    );
    expect(server.adapter).not.toHaveBeenCalled();
  });
});
