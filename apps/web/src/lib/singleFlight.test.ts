import { describe, expect, it } from 'vitest';
import { singleFlight } from './singleFlight';

describe('singleFlight — chặn gọi lặp khi lần trước còn chạy (giữ phím Ctrl+Enter, bấm đúp)', () => {
  it('lần gọi thứ hai khi lần đầu chưa xong bị bỏ qua; xong rồi gọi lại được', async () => {
    const ref = { current: false };
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const task = async () => {
      runs++;
      await gate;
    };
    const first = singleFlight(ref, task);
    const second = singleFlight(ref, task); // cùng tick: key-repeat
    const third = singleFlight(ref, task);
    expect(ref.current).toBe(true); // đặt đồng bộ, không đợi render
    release();
    await Promise.all([first, second, third]);
    expect(runs).toBe(1);
    expect(ref.current).toBe(false);
    await singleFlight(ref, () => {
      runs++;
      return Promise.resolve();
    });
    expect(runs).toBe(2);
  });
  it('tác vụ ném lỗi vẫn nhả khoá (lần sau lưu lại được)', async () => {
    const ref = { current: false };
    await expect(singleFlight(ref, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(ref.current).toBe(false);
  });
});
