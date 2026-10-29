import { afterEach, describe, expect, it, vi } from 'vitest';
import { Semaphore } from './semaphore';

const FAR = () => Date.now() + 60_000;
afterEach(() => vi.useRealTimers());

/** Chạy một việc giữ chỗ; trả null nếu không có chỗ trước hạn. */
async function guarded<T>(
  sem: Semaphore,
  deadlineAt: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const release = await sem.acquire(deadlineAt);
  if (!release) return null;
  try {
    return await fn();
  } finally {
    release();
  }
}

describe('Semaphore', () => {
  it('10 người gọi đồng thời, tối đa 3 việc chạy cùng lúc, cả 10 đều xong', async () => {
    const sem = new Semaphore(3);
    let live = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        guarded(sem, FAR(), async () => {
          live++;
          peak = Math.max(peak, live);
          await new Promise((r) => setTimeout(r, 2));
          live--;
          return i;
        }),
      ),
    );
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
    expect(sem.inFlight).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  it('nhả chỗ khi việc ném lỗi (không rò chỗ)', async () => {
    const sem = new Semaphore(1);
    await expect(guarded(sem, FAR(), () => Promise.reject(new Error('hỏng')))).rejects.toThrow(
      'hỏng',
    );
    expect(sem.inFlight).toBe(0);
    expect(await guarded(sem, FAR(), () => Promise.resolve('ok'))).toBe('ok');
  });

  it('hết hạn khi đang chờ → null, bỏ khỏi hàng chờ, KHÔNG chiếm chỗ', async () => {
    vi.useFakeTimers();
    const sem = new Semaphore(1);
    const holder = await sem.acquire(Date.now() + 60_000); // giữ chỗ duy nhất
    const waiter = sem.acquire(Date.now() + 1_000);
    expect(sem.waiting).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await waiter).toBeNull();
    expect(sem.waiting).toBe(0);
    holder!();
    expect(sem.inFlight).toBe(0); // chỗ không bị trao cho người đã hết hạn
  });

  it('đã quá hạn từ trước thì null ngay cả khi còn chỗ trống', async () => {
    const sem = new Semaphore(3);
    expect(await sem.acquire(Date.now() - 1)).toBeNull();
    expect(sem.inFlight).toBe(0);
  });

  it('nhả chỗ thì trao cho người chờ lâu nhất (FIFO) trước hạn', async () => {
    vi.useFakeTimers();
    const sem = new Semaphore(1);
    const first = await sem.acquire(Date.now() + 10_000);
    const order: string[] = [];
    const a = sem.acquire(Date.now() + 10_000).then((r) => (order.push('a'), r));
    const b = sem.acquire(Date.now() + 10_000).then((r) => (order.push('b'), r));
    first!();
    const ra = await a;
    expect(order).toEqual(['a']);
    ra!();
    (await b)!();
    expect(order).toEqual(['a', 'b']);
    expect(sem.inFlight).toBe(0);
  });

  it('release gọi hai lần chỉ nhả một chỗ', async () => {
    const sem = new Semaphore(2);
    const r1 = (await sem.acquire(FAR()))!;
    const r2 = (await sem.acquire(FAR()))!;
    r1();
    r1();
    expect(sem.inFlight).toBe(1);
    r2();
    expect(sem.inFlight).toBe(0);
  });
});
