import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = () => void;

/** Socket giả: ghi lại emit và cho phép kích hoạt `connect` thủ công. */
function makeFakeSocket() {
  const handlers = new Map<string, Set<Handler>>();
  const sock = {
    connected: false,
    emitted: [] as Array<[string, unknown]>,
    emit: vi.fn((ev: string, payload: unknown) => {
      sock.emitted.push([ev, payload]);
    }),
    connect: vi.fn(() => {
      sock.fire('connect');
    }),
    on: vi.fn((ev: string, h: Handler) => {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(h);
    }),
    off: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    fire(ev: string) {
      if (ev === 'connect') sock.connected = true;
      handlers.get(ev)?.forEach((h) => h());
    },
  };
  return sock;
}

let fake: ReturnType<typeof makeFakeSocket>;
vi.mock('socket.io-client', () => ({ io: () => fake }));

const room = { kind: 'project', id: 'p1' } as const;
const subs = () => fake.emitted.filter(([ev]) => ev === 'subscribe');
const unsubs = () => fake.emitted.filter(([ev]) => ev === 'unsubscribe');

describe('acquireRoom — registry room dùng chung', () => {
  beforeEach(() => {
    fake = makeFakeSocket();
    vi.resetModules();
  });

  it('hai bên cùng room: bên rời trước KHÔNG unsubscribe, chỉ người cuối mới unsubscribe', async () => {
    const { acquireRoom } = await import('./socket');
    const releasePresence = acquireRoom(room); // chưa kết nối → connect() kéo theo subscribe
    const releaseRealtime = acquireRoom(room);
    expect(subs()).toHaveLength(1);

    releasePresence(); // vd BoardPage unmount
    expect(unsubs()).toHaveLength(0);

    releaseRealtime();
    expect(unsubs()).toHaveLength(1);
  });

  it('release gọi hai lần chỉ trừ một ref', async () => {
    const { acquireRoom } = await import('./socket');
    const a = acquireRoom(room);
    acquireRoom(room);
    a();
    a();
    expect(unsubs()).toHaveLength(0);
  });

  it('nối lại: subscribe lại mọi room và gọi onReconnect (không gọi ở lần vào đầu)', async () => {
    const { acquireRoom } = await import('./socket');
    const onReconnect = vi.fn();
    acquireRoom(room, onReconnect);
    expect(subs()).toHaveLength(1);
    expect(onReconnect).not.toHaveBeenCalled();

    fake.fire('connect'); // reconnect
    expect(subs()).toHaveLength(2);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('room vào sau khi đã kết nối được subscribe ngay, đúng một lần', async () => {
    const { acquireRoom } = await import('./socket');
    acquireRoom({ kind: 'issue', id: 'i1' }); // kéo connect
    acquireRoom(room);
    acquireRoom(room);
    expect(subs().filter(([, t]) => (t as { id: string }).id === 'p1')).toHaveLength(1);
  });
});
