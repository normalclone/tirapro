import { describe, expect, it, vi } from 'vitest';
import { isRowKey, stopRowKeys } from './rowKeys';

const press = (key: string, extra: Record<string, boolean> = {}) => {
  const stopPropagation = vi.fn();
  stopRowKeys({ key, stopPropagation, ...extra });
  return stopPropagation.mock.calls.length > 0;
};

describe('stopRowKeys — chỉ chặn phím mà dòng/thẻ dùng', () => {
  it('Enter, Space, mũi tên (mở xem nhanh / nhấc thẻ / dời thẻ) bị chặn', () => {
    for (const k of ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
      expect(press(k), k).toBe(true);
  });
  it('phím TOÀN CỤC đi tiếp tới window: Cmd/Ctrl+K, ?, g-chord, c, j/k, Tab, Esc', () => {
    for (const k of ['k', 'K', '?', 'g', 'c', 'j', 'Tab', 'Escape', '/'])
      expect(press(k, { metaKey: true }), k).toBe(false);
    expect(press('k', { ctrlKey: true })).toBe(false);
  });
  it('isRowKey khớp', () => {
    expect(isRowKey('Enter')).toBe(true);
    expect(isRowKey('k')).toBe(false);
  });
});
