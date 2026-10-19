import { describe, expect, it, vi } from 'vitest';
import { clearSelection, EMPTY_SELECTION, pruneSelection, toggleId } from './selection';
import { createSelectionStore } from './selectionStore';

describe('createSelectionStore', () => {
  it('báo người nghe khi đổi, không báo khi hàm trả về cùng tham chiếu', () => {
    const store = createSelectionStore();
    const l = vi.fn();
    store.subscribe(l);
    store.update((s) => toggleId(s, 'a'));
    expect(l).toHaveBeenCalledTimes(1);
    store.update((s) => pruneSelection(s, new Set(['a']))); // không bỏ gì → cùng tham chiếu
    expect(l).toHaveBeenCalledTimes(1);
    store.update(clearSelection);
    expect(l).toHaveBeenCalledTimes(2);
    store.update(clearSelection); // đã rỗng
    expect(l).toHaveBeenCalledTimes(2);
    expect(store.getState()).toBe(EMPTY_SELECTION);
  });
  it('huỷ đăng ký thì không còn được báo', () => {
    const store = createSelectionStore();
    const l = vi.fn();
    const off = store.subscribe(l);
    off();
    store.update((s) => toggleId(s, 'a'));
    expect(l).not.toHaveBeenCalled();
  });
});
