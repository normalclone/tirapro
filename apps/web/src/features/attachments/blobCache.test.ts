import { describe, expect, it, vi } from 'vitest';
import { BlobUrlCache } from './blobCache';

describe('BlobUrlCache', () => {
  it('đẩy mục cũ nhất khi vượt giới hạn và revoke URL của nó', () => {
    const revoke = vi.fn();
    const c = new BlobUrlCache(2, revoke);
    c.set('a', 'blob:a');
    c.set('b', 'blob:b');
    c.get('a');
    c.set('c', 'blob:c');
    expect(revoke).toHaveBeenCalledWith('blob:b');
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe('blob:a');
  });

  it('set lại cùng khoá thì revoke bản cũ', () => {
    const revoke = vi.fn();
    const c = new BlobUrlCache(2, revoke);
    c.set('a', 'blob:1');
    c.set('a', 'blob:2');
    expect(revoke).toHaveBeenCalledWith('blob:1');
    expect(c.get('a')).toBe('blob:2');
  });

  it('không revoke khi chưa vượt giới hạn', () => {
    const revoke = vi.fn();
    const c = new BlobUrlCache(3, revoke);
    c.set('a', 'blob:a');
    c.set('b', 'blob:b');
    expect(revoke).not.toHaveBeenCalled();
  });
});
