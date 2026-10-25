import { describe, expect, it } from 'vitest';
import { mapLimit } from './map-limit';

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

describe('mapLimit', () => {
  it('không bao giờ quá `limit` việc đồng thời, giữ thứ tự kết quả', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await tick();
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
  it('rỗng → [] và không gọi fn', async () => {
    expect(await mapLimit([], 3, () => Promise.reject(new Error('không được gọi')))).toEqual([]);
  });
  it('lỗi → ném lỗi đầu tiên, ngừng bắt đầu việc mới', async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        await tick();
        if (n === 2) throw new Error('hỏng 2');
        return n;
      }),
    ).rejects.toThrow('hỏng 2');
    expect(started.length).toBeLessThan(6);
  });
});
