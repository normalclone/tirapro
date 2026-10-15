import { describe, expect, it, vi } from 'vitest';
import { dropHint } from './dropHint';

describe('dropHint store', () => {
  it('chỉ báo subscriber khi hint đổi thật; clear về null', () => {
    const fn = vi.fn();
    const off = dropHint.subscribe(fn);
    dropHint.set({ id: 'a', edge: 'before' });
    dropHint.set({ id: 'a', edge: 'before' }); // trùng → bỏ qua
    dropHint.set({ id: 'a', edge: 'after' });
    dropHint.set(null);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(dropHint.get()).toBeNull();
    off();
    dropHint.set({ id: 'b', edge: 'before' });
    expect(fn).toHaveBeenCalledTimes(3);
    dropHint.set(null);
  });
});
