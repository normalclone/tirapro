import { describe, expect, it, vi } from 'vitest';
import { queryClient } from './queryClient';
import { clearSessionCaches, registerSessionCleaner } from './sessionCache';

describe('clearSessionCaches', () => {
  it('xoá react-query và gọi mọi cache đã đăng ký, kể cả khi một cache ném lỗi', () => {
    queryClient.setQueryData(['x'], 1);
    const a = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const c = vi.fn();
    registerSessionCleaner(a);
    registerSessionCleaner(bad);
    registerSessionCleaner(c);
    clearSessionCaches();
    expect(queryClient.getQueryData(['x'])).toBeUndefined();
    expect([a, bad, c].every((f) => f.mock.calls.length === 1)).toBe(true);
  });
});
