import { describe, expect, it, vi } from 'vitest';
import { dropContainer } from './dropContainer';

describe('dropContainer store', () => {
  it('chỉ báo khi container đích đổi thật; huỷ đăng ký thì thôi báo', () => {
    const fn = vi.fn();
    const off = dropContainer.subscribe(fn);
    dropContainer.set('c1');
    dropContainer.set('c1');
    dropContainer.set('c2');
    dropContainer.set(null);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(dropContainer.get()).toBeNull();
    off();
    dropContainer.set('c3');
    expect(fn).toHaveBeenCalledTimes(3);
    dropContainer.set(null);
  });
});
