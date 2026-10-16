import { describe, expect, it, vi } from 'vitest';
import { createSequentially, summarizeFailures } from './createSequence';

const items = [1, 2, 3, 4].map((id) => ({ id, payload: id }));
const soft = (e: unknown) => ({ message: String((e as Error).message), halt: false });

describe('createSequentially', () => {
  it('tạo đúng thứ tự, tuần tự (không chạy chồng)', async () => {
    const order: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const post = async (p: number) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      order.push(p);
      running--;
    };
    const r = await createSequentially(items, post, soft);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(maxRunning).toBe(1);
    expect(r).toEqual({ created: [1, 2, 3, 4], failed: [], halted: false, notTried: [] });
  });
  it('lỗi thường không dừng lượt và giữ lý do từng mục', async () => {
    const post = vi.fn((p: number) =>
      p === 2 ? Promise.reject(new Error('Tiêu đề quá dài')) : Promise.resolve(),
    );
    const r = await createSequentially(items, post, soft);
    expect(post).toHaveBeenCalledTimes(4);
    expect(r.created).toEqual([1, 3, 4]);
    expect(r.failed).toEqual([{ id: 2, message: 'Tiêu đề quá dài' }]);
    expect(r.halted).toBe(false);
  });
  it('lỗi hệ thống (halt) dừng ngay, không thử các mục còn lại', async () => {
    const post = vi.fn((p: number) =>
      p === 2 ? Promise.reject(new Error('403')) : Promise.resolve(),
    );
    const progress = vi.fn();
    const r = await createSequentially(
      items,
      post,
      (e) => ({ message: (e as Error).message, halt: true }),
      progress,
    );
    expect(post).toHaveBeenCalledTimes(2);
    expect(r).toEqual({
      created: [1],
      failed: [{ id: 2, message: '403' }],
      halted: true,
      notTried: [3, 4],
    });
    expect(progress).toHaveBeenLastCalledWith(2, 4);
  });
});

describe('summarizeFailures', () => {
  it('gom lý do trùng', () => {
    expect(summarizeFailures([{ message: 'A' }, { message: 'B' }, { message: 'A' }])).toBe(
      'A (×2); B',
    );
  });
});
