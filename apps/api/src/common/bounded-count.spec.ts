import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boundedCountSlotsSemaphore,
  boundedCountSlots,
  boundedIssueCount,
  isCountTimeout,
  prismaPoolSize,
} from './bounded-count';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function fakePrisma(countImpl: () => Promise<number> = () => Promise.resolve(7)) {
  const order: string[] = [];
  const tx = {
    $executeRaw: vi.fn((sql: { sql: string }) => {
      order.push(`raw:${sql.sql}`);
      return Promise.resolve(0);
    }),
    issue: {
      count: vi.fn((args: object) => {
        order.push('count');
        void args;
        return countImpl();
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>, opts: unknown) => {
      order.push(`tx:${JSON.stringify(opts)}`);
      return fn(tx);
    }),
  };
  return { prisma, tx, order };
}
const far = () => Date.now() + 60_000;

describe('boundedIssueCount', () => {
  it('giao dịch → SET LOCAL statement_timeout = 3000 → đếm; where luôn kèm deletedAt: null', async () => {
    const { prisma, tx, order } = fakePrisma();
    const n = await boundedIssueCount(prisma as never, { statusId: 's1' }, far());
    expect(n).toBe(7);
    expect(order).toEqual([
      'tx:{"maxWait":2000,"timeout":5000}',
      'raw:SET LOCAL statement_timeout = 3000',
      'count',
    ]);
    expect(tx.issue.count).toHaveBeenCalledWith({
      where: { deletedAt: null, AND: [{ statusId: 's1' }] },
    });
    expect(boundedCountSlotsSemaphore().inFlight).toBe(0);
  });

  it('quá hạn → null, lỗi khác → ném; chỗ luôn được nhả', async () => {
    const timeout = Object.assign(new Error('x'), { code: 'P2010', meta: { code: '57014' } });
    const a = fakePrisma(() => Promise.reject(timeout));
    expect(await boundedIssueCount(a.prisma as never, {}, far())).toBeNull();
    const b = fakePrisma(() => Promise.reject(new Error('connection refused')));
    await expect(boundedIssueCount(b.prisma as never, {}, far())).rejects.toThrow('refused');
    expect(boundedCountSlotsSemaphore().inFlight).toBe(0);
  });

  it('đã quá hạn → null, không mở giao dịch', async () => {
    const { prisma } = fakePrisma();
    expect(await boundedIssueCount(prisma as never, {}, Date.now() - 1)).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trần chung theo pool: hết chỗ thì chờ đến hạn rồi null (không chờ vô hạn)', async () => {
    vi.useFakeTimers();
    const sem = boundedCountSlotsSemaphore();
    const held = await Promise.all(
      Array.from({ length: sem.capacity }, () => sem.acquire(Date.now() + 1e6)),
    );
    const { prisma } = fakePrisma();
    const p = boundedIssueCount(prisma as never, {}, Date.now() + 5_000);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    held.forEach((r) => r!());
    expect(boundedCountSlotsSemaphore().inFlight).toBe(0);
  });
});

describe('isCountTimeout — khớp hẹp', () => {
  it('nhận: meta.code 57014, cụm Postgres, thẻ code: "57014", P2028', () => {
    expect(isCountTimeout(Object.assign(new Error('x'), { meta: { code: '57014' } }))).toBe(true);
    expect(isCountTimeout(new Error('ERROR: canceling statement due to statement timeout'))).toBe(
      true,
    );
    expect(isCountTimeout(new Error('PostgresError { code: "57014", message: "x" }'))).toBe(true);
    expect(isCountTimeout(Object.assign(new Error('x'), { code: 'P2028' }))).toBe(true);
  });
  it('không nhận: số 57014 / chữ "statement timeout" rời rạc, lỗi không phải Error', () => {
    expect(isCountTimeout(new Error('connect ECONNREFUSED 127.0.0.1:57014'))).toBe(false);
    expect(isCountTimeout(new Error('port 570145 refused'))).toBe(false);
    expect(isCountTimeout(new Error('invalid statement timeout setting'))).toBe(false);
    expect(isCountTimeout('canceling statement due to statement timeout')).toBe(false);
  });
});

describe('prismaPoolSize / boundedCountSlots (ngân sách kết nối theo pool thật)', () => {
  const url = (q: string) => `postgresql://u:p@h:5432/db?${q}`;

  it('đọc connection_limit từ DATABASE_URL, ở bất kỳ vị trí nào trong query', () => {
    expect(prismaPoolSize(url('schema=public&connection_limit=10&pool_timeout=20'), 1)).toBe(10);
    expect(prismaPoolSize(url('connection_limit=6'), 8)).toBe(6);
    expect(prismaPoolSize(url('schema=public&connection_limit=4'), 8)).toBe(4);
  });

  it('không có connection_limit → mặc định của Prisma: num_cpus*2+1', () => {
    expect(prismaPoolSize('postgresql://u:p@h:5432/db', 1)).toBe(3);
    expect(prismaPoolSize(url('schema=public'), 2)).toBe(5);
    expect(prismaPoolSize(undefined, 4)).toBe(9);
  });

  it('connection_limit không hợp lệ (0, âm, chữ) → rơi về mặc định', () => {
    expect(prismaPoolSize(url('connection_limit=0'), 1)).toBe(3);
    expect(prismaPoolSize(url('connection_limit=abc'), 2)).toBe(5);
    expect(prismaPoolSize(url('connection_limit=-3'), 1)).toBe(3);
  });

  it('không nhầm tham số khác có đuôi connection_limit', () => {
    expect(prismaPoolSize(url('x_connection_limit=99'), 1)).toBe(3);
  });

  it('số chỗ = clamp(floor(pool/3), 1, 3): không bao giờ quá ~1/3 pool', () => {
    expect(boundedCountSlots(1)).toBe(1);
    expect(boundedCountSlots(2)).toBe(1);
    expect(boundedCountSlots(3)).toBe(1);
    expect(boundedCountSlots(5)).toBe(1);
    expect(boundedCountSlots(6)).toBe(2);
    expect(boundedCountSlots(8)).toBe(2);
    expect(boundedCountSlots(9)).toBe(3);
    expect(boundedCountSlots(10)).toBe(3);
    expect(boundedCountSlots(100)).toBe(3);
  });

  it('pool 1 vCPU của Render (3 kết nối) chỉ nhường 1 chỗ cho đếm xem trước', () => {
    expect(boundedCountSlots(prismaPoolSize('postgresql://u:p@h/db', 1))).toBe(1);
    expect(boundedCountSlots(prismaPoolSize(url('connection_limit=10&pool_timeout=20'), 1))).toBe(
      3,
    );
  });

  it('pool không hữu hạn (NaN/0) vẫn cho ≥ 1 chỗ', () => {
    expect(boundedCountSlots(0)).toBe(1);
    expect(boundedCountSlots(Number.NaN)).toBe(1);
  });
});

describe('boundedCountSlotsSemaphore (dựng lười theo DATABASE_URL lúc dùng lần đầu)', () => {
  async function capacityFor(databaseUrl: string): Promise<number> {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', databaseUrl);
    const mod = await import('./bounded-count');
    return mod.boundedCountSlotsSemaphore().capacity;
  }

  it('connection_limit=10 → 3 chỗ; connection_limit=6 → 2; connection_limit=2 → 1', async () => {
    expect(await capacityFor('postgresql://u:p@h/db?connection_limit=10')).toBe(3);
    expect(await capacityFor('postgresql://u:p@h/db?connection_limit=6')).toBe(2);
    expect(await capacityFor('postgresql://u:p@h/db?connection_limit=2')).toBe(1);
  });

  it('dùng một thể hiện duy nhất cho cả tiến trình', async () => {
    vi.resetModules();
    const mod = await import('./bounded-count');
    expect(mod.boundedCountSlotsSemaphore()).toBe(mod.boundedCountSlotsSemaphore());
  });
});
