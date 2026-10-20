import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOUNDED_COUNT_SLOTS, boundedIssueCount, isCountTimeout } from './bounded-count';

afterEach(() => vi.useRealTimers());

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
    expect(BOUNDED_COUNT_SLOTS.inFlight).toBe(0);
  });

  it('quá hạn → null, lỗi khác → ném; chỗ luôn được nhả', async () => {
    const timeout = Object.assign(new Error('x'), { code: 'P2010', meta: { code: '57014' } });
    const a = fakePrisma(() => Promise.reject(timeout));
    expect(await boundedIssueCount(a.prisma as never, {}, far())).toBeNull();
    const b = fakePrisma(() => Promise.reject(new Error('connection refused')));
    await expect(boundedIssueCount(b.prisma as never, {}, far())).rejects.toThrow('refused');
    expect(BOUNDED_COUNT_SLOTS.inFlight).toBe(0);
  });

  it('đã quá hạn → null, không mở giao dịch', async () => {
    const { prisma } = fakePrisma();
    expect(await boundedIssueCount(prisma as never, {}, Date.now() - 1)).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trần chung 3 chỗ: hết chỗ thì chờ đến hạn rồi null (không chờ vô hạn)', async () => {
    vi.useFakeTimers();
    const held = await Promise.all(
      [1, 2, 3].map(() => BOUNDED_COUNT_SLOTS.acquire(Date.now() + 1e6)),
    );
    const { prisma } = fakePrisma();
    const p = boundedIssueCount(prisma as never, {}, Date.now() + 5_000);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    held.forEach((r) => r!());
    expect(BOUNDED_COUNT_SLOTS.inFlight).toBe(0);
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
