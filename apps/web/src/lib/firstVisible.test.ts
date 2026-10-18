import { describe, expect, it } from 'vitest';
import { firstVisible } from './firstVisible';

const el = (rects: number) => ({ getClientRects: () => ({ length: rects }) }) as unknown as Element;

describe('firstVisible', () => {
  it('bỏ qua phần tử ẩn (display:none → không có client rect)', () => {
    const hidden = el(0);
    const shown = el(1);
    expect(firstVisible([hidden, shown])).toBe(shown);
  });
  it('lấy phần tử hiển thị ĐẦU TIÊN theo thứ tự', () => {
    const a = el(1);
    const b = el(2);
    expect(firstVisible([el(0), a, b])).toBe(a);
  });
  it('không có phần tử hiển thị → null', () => {
    expect(firstVisible([el(0)])).toBeNull();
    expect(firstVisible([])).toBeNull();
  });
  it('nhận cả NodeList-like (có length + chỉ số) chứ không chỉ mảng', () => {
    const shown = el(1);
    const list = { 0: el(0), 1: shown, length: 2 } as unknown as ArrayLike<Element>;
    expect(firstVisible(list)).toBe(shown);
  });
});
