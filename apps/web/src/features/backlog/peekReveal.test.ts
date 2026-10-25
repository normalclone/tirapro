import { describe, expect, it, vi } from 'vitest';
import { createRevealRegistry } from './peekReveal';

describe('createRevealRegistry', () => {
  it('hỏi từng khu cho tới khi một khu nhận; khu nhận dừng chuỗi', () => {
    const r = createRevealRegistry();
    const a = vi.fn().mockReturnValue(false);
    const b = vi.fn().mockReturnValue(true);
    const c = vi.fn().mockReturnValue(true);
    r.add(a);
    r.add(b);
    r.add(c);
    expect(r.reveal('X-1')).toBe(true);
    expect(a).toHaveBeenCalledWith('X-1');
    expect(b).toHaveBeenCalledWith('X-1');
    expect(c).not.toHaveBeenCalled();
  });
  it('không khu nào nhận → false; gỡ đăng ký thì không còn được hỏi', () => {
    const r = createRevealRegistry();
    const a = vi.fn().mockReturnValue(true);
    const off = r.add(a);
    off();
    expect(r.reveal('X-1')).toBe(false);
    expect(a).not.toHaveBeenCalled();
  });
});
