import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceService, PRESENCE_TTL_MS } from './presence.service';

/** Redis giả tối thiểu: chỉ các lệnh hash mà PresenceService dùng. */
function fakeRedisClient() {
  const store = new Map<string, Map<string, string>>();
  const hash = (k: string) => {
    let h = store.get(k);
    if (!h) store.set(k, (h = new Map<string, string>()));
    return h;
  };
  return {
    store,
    hset: vi.fn((k: string, f: string, v: string) => {
      hash(k).set(f, v);
      return Promise.resolve(1);
    }),
    hget: vi.fn((k: string, f: string) => Promise.resolve(store.get(k)?.get(f) ?? null)),
    hgetall: vi.fn((k: string) => Promise.resolve(Object.fromEntries(store.get(k) ?? []))),
    hdel: vi.fn((k: string, ...fs: string[]) => {
      let n = 0;
      for (const f of fs) if (store.get(k)?.delete(f)) n++;
      return Promise.resolve(n);
    }),
    expire: vi.fn(() => Promise.resolve(1)),
  };
}

function makeService(opts: { available?: boolean } = {}) {
  const client = fakeRedisClient();
  const redis = {
    isAvailable: vi.fn(() => opts.available ?? true),
    getClient: vi.fn(() => client),
  };
  return { service: new PresenceService(redis as never), client, redis };
}

const alice = { userId: 'U1', displayName: 'An', avatarUrl: null };
const bob = { userId: 'U2', displayName: 'Bình', avatarUrl: 'http://x/b.png' };

describe.each([
  ['Redis', true],
  ['in-memory (Redis không sẵn sàng)', false],
])('PresenceService — %s', (_name, available) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('join rồi state trả đủ người, viewing mặc định null', async () => {
    const { service } = makeService({ available });
    await service.join('project:P1', alice);
    await service.join('project:P1', bob);
    const users = await service.state('project:P1');
    expect(users).toHaveLength(2);
    expect(users).toContainEqual({ userId: 'U1', displayName: 'An', avatarUrl: null, viewing: null });
    expect(users).toContainEqual({ userId: 'U2', displayName: 'Bình', avatarUrl: 'http://x/b.png', viewing: null });
  });

  it('state không lẫn room khác', async () => {
    const { service } = makeService({ available });
    await service.join('project:P1', alice);
    await service.join('project:P2', bob);
    expect((await service.state('project:P1')).map((u) => u.userId)).toEqual(['U1']);
  });

  it('leave xoá người khỏi room', async () => {
    const { service } = makeService({ available });
    await service.join('project:P1', alice);
    await service.join('project:P1', bob);
    await service.leave('project:P1', 'U1');
    expect((await service.state('project:P1')).map((u) => u.userId)).toEqual(['U2']);
  });

  it('lọc (và dọn) entry quá 60 giây không heartbeat', async () => {
    const { service } = makeService({ available });
    await service.join('project:P1', alice);
    vi.advanceTimersByTime(PRESENCE_TTL_MS - 1_000);
    await service.join('project:P1', bob);
    vi.advanceTimersByTime(2_000); // alice quá hạn, bob còn
    expect((await service.state('project:P1')).map((u) => u.userId)).toEqual(['U2']);
    // lần đọc sau vẫn vậy — entry hết hạn đã bị dọn
    expect((await service.state('project:P1')).map((u) => u.userId)).toEqual(['U2']);
  });

  it('setViewing cập nhật viewing + làm mới ts; trả changed theo giá trị', async () => {
    const { service } = makeService({ available });
    await service.join('project:P1', alice);
    expect(await service.setViewing('project:P1', 'U1', 'issue:I1')).toEqual({
      changed: true,
      user: { userId: 'U1', displayName: 'An', avatarUrl: null, viewing: 'issue:I1' },
    });
    vi.advanceTimersByTime(PRESENCE_TTL_MS - 5_000);
    // heartbeat: cùng viewing -> không đổi nhưng làm mới ts
    expect((await service.setViewing('project:P1', 'U1', 'issue:I1'))?.changed).toBe(false);
    vi.advanceTimersByTime(PRESENCE_TTL_MS - 5_000);
    expect((await service.state('project:P1'))[0]?.viewing).toBe('issue:I1');
    expect((await service.setViewing('project:P1', 'U1', null))?.changed).toBe(true);
  });

  it('setViewing cho người chưa join -> null', async () => {
    const { service } = makeService({ available });
    expect(await service.setViewing('project:P1', 'U9', 'issue:I1')).toBeNull();
  });

  it('bỏ qua entry JSON hỏng thay vì ném', async () => {
    const { service, client } = makeService({ available });
    await service.join('project:P1', alice);
    if (available) client.store.get('presence:project:P1')?.set('UX', '{không phải json');
    expect((await service.state('project:P1')).map((u) => u.userId)).toEqual(['U1']);
  });
});

describe('PresenceService — Redis', () => {
  it('lưu hash presence:{room} với userId -> JSON{displayName,avatarUrl,viewing,ts} + đặt TTL cho key', async () => {
    const { service, client } = makeService();
    await service.join('project:P1', alice);
    const raw = client.store.get('presence:project:P1')?.get('U1');
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ displayName: 'An', avatarUrl: null, viewing: null });
    expect(typeof (JSON.parse(raw ?? '{}') as { ts?: unknown }).ts).toBe('number');
    expect(client.expire).toHaveBeenCalledWith('presence:project:P1', expect.any(Number));
  });

  it('Redis lỗi giữa chừng -> rơi về bộ nhớ, không ném', async () => {
    const { service, client } = makeService();
    client.hset.mockRejectedValue(new Error('boom'));
    client.hgetall.mockRejectedValue(new Error('boom'));
    await expect(service.join('project:P1', alice)).resolves.toBeDefined();
    expect((await service.state('project:P1')).map((u) => u.userId)).toEqual(['U1']);
  });
});
