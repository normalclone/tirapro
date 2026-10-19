import { describe, expect, it, vi } from 'vitest';
import { getQuickAddTypeKey, setQuickAddTypeKey, subscribeQuickAddType } from './quickAddType';

describe('quickAddType (loại nhớ dùng chung giữa các ô thêm nhanh)', () => {
  it('đổi ở một nơi thì mọi ô đang nghe được báo và đọc ra khoá mới (kể cả khi không có localStorage)', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeQuickAddType(a);
    const offB = subscribeQuickAddType(b);
    setQuickAddTypeKey('BUG');
    expect(getQuickAddTypeKey()).toBe('BUG');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    setQuickAddTypeKey('STORY');
    expect(a).toHaveBeenCalledTimes(1); // đã huỷ đăng ký
    expect(b).toHaveBeenCalledTimes(2);
    expect(getQuickAddTypeKey()).toBe('STORY');
    offB();
  });
});
