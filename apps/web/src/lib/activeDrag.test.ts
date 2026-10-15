import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeDrag } from './activeDrag';

afterEach(() => activeDrag.set(null));

describe('activeDrag', () => {
  it('chỉ báo người nghe khi giá trị THẬT SỰ đổi', () => {
    const f = vi.fn();
    const off = activeDrag.subscribe(f);
    activeDrag.set('a');
    activeDrag.set('a');
    expect(f).toHaveBeenCalledTimes(1);
    expect(activeDrag.get()).toBe('a');
    activeDrag.set(null);
    expect(f).toHaveBeenCalledTimes(2);
    off();
    activeDrag.set('b');
    expect(f).toHaveBeenCalledTimes(2);
  });
});
