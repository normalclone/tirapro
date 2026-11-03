import { beforeEach, describe, expect, it } from 'vitest';
import { readCollapsed, sidebarKey, useSidebar, writeCollapsed } from './sidebar';

describe('thanh điều hướng thu gọn (logbug #1)', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
      },
    });
    useSidebar.setState({ collapsed: false });
  });

  it('nhớ theo từng tài khoản', () => {
    writeCollapsed('u1', true);
    expect(readCollapsed('u1')).toBe(true);
    expect(readCollapsed('u2')).toBe(false);
    expect(sidebarKey('u1')).not.toBe(sidebarKey('u2'));
  });

  it('toggle đổi trạng thái và lưu; hydrate nạp lại đúng của tài khoản', () => {
    useSidebar.getState().toggle('u1');
    expect(useSidebar.getState().collapsed).toBe(true);
    useSidebar.getState().hydrate('u2');
    expect(useSidebar.getState().collapsed).toBe(false);
    useSidebar.getState().hydrate('u1');
    expect(useSidebar.getState().collapsed).toBe(true);
  });

  it('localStorage hỏng không làm vỡ', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    expect(readCollapsed('u1')).toBe(false);
    expect(() => useSidebar.getState().toggle('u1')).not.toThrow();
  });
});
