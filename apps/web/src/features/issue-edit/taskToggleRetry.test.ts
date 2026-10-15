import { describe, expect, it, vi } from 'vitest';
import { toggleWithRetry, type ToggleRetryDeps } from './taskToggleRetry';

const conflict = new Error('409');

function deps(over: Partial<ToggleRetryDeps> = {}) {
  let cache = { text: '- [ ] a\n- [ ] b', version: 1 };
  const d = {
    read: vi.fn(() => cache),
    plan: vi.fn((t: string) => t.replace('- [ ] b', '- [x] b')),
    write: vi.fn(() => Promise.resolve()),
    reload: vi.fn(() => {
      cache = { text: '- [x] a\n- [ ] b', version: 2 }; // người khác vừa tick mục a
      return Promise.resolve();
    }),
    isConflict: (e: unknown) => e === conflict,
    onMissing: vi.fn(),
    onMismatch: vi.fn(),
    onError: vi.fn(),
  };
  return { ...d, ...over } as typeof d;
}

describe('toggleWithRetry', () => {
  it('thành công ngay: ghi một lần với version hiện có', async () => {
    const d = deps();
    await toggleWithRetry(d);
    expect(d.write).toHaveBeenCalledTimes(1);
    expect(d.write).toHaveBeenCalledWith('- [ ] a\n- [x] b', 1);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it('409 → nạp lại → áp lại trên bản mới (version 2) và giữ cú tick của người kia', async () => {
    const d = deps();
    d.write.mockRejectedValueOnce(conflict);
    await toggleWithRetry(d);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.write).toHaveBeenCalledTimes(2);
    expect(d.write).toHaveBeenLastCalledWith('- [x] a\n- [x] b', 2);
    expect(d.onError).not.toHaveBeenCalled();
  });

  it('409 hai lần liên tiếp → báo lỗi, không thử lần ba', async () => {
    const d = deps();
    d.write.mockRejectedValue(conflict);
    await toggleWithRetry(d);
    expect(d.write).toHaveBeenCalledTimes(2);
    expect(d.onError).toHaveBeenCalledWith(conflict);
  });

  it('lỗi khác 409 → báo ngay, không nạp lại', async () => {
    const d = deps();
    const boom = new Error('500');
    d.write.mockRejectedValueOnce(boom);
    await toggleWithRetry(d);
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.onError).toHaveBeenCalledWith(boom);
  });

  it('sau khi nạp lại mục đã đổi nội dung → onMismatch, không ghi lần hai', async () => {
    const d = deps({ plan: vi.fn((t: string) => (t.startsWith('- [x] a') ? null : t)) });
    d.write.mockRejectedValueOnce(conflict);
    await toggleWithRetry(d);
    expect(d.onMismatch).toHaveBeenCalledTimes(1);
    expect(d.write).toHaveBeenCalledTimes(1);
  });

  it('thiếu dữ liệu trong cache → onMissing (không im lặng)', async () => {
    const d = deps({ read: vi.fn(() => undefined) });
    await toggleWithRetry(d);
    expect(d.onMissing).toHaveBeenCalledTimes(1);
    expect(d.write).not.toHaveBeenCalled();
  });
});
