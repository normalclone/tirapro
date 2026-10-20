import { describe, expect, it } from 'vitest';
import { nextCell } from './matrixNav';

const at = (r: number, c: number) => ({ r, c });
const nav = (p: { r: number; c: number }, key: string, ctrl = false) =>
  nextCell(p, key, { rows: 4, cols: 3 }, ctrl);

describe('nextCell (điều hướng mũi tên trong lưới ô)', () => {
  it('bốn mũi tên, kẹp ở biên (không vòng)', () => {
    expect(nav(at(1, 1), 'ArrowRight')).toEqual(at(1, 2));
    expect(nav(at(1, 2), 'ArrowRight')).toEqual(at(1, 2));
    expect(nav(at(1, 1), 'ArrowLeft')).toEqual(at(1, 0));
    expect(nav(at(1, 0), 'ArrowLeft')).toEqual(at(1, 0));
    expect(nav(at(1, 1), 'ArrowDown')).toEqual(at(2, 1));
    expect(nav(at(3, 1), 'ArrowDown')).toEqual(at(3, 1));
    expect(nav(at(1, 1), 'ArrowUp')).toEqual(at(0, 1));
    expect(nav(at(0, 1), 'ArrowUp')).toEqual(at(0, 1));
  });
  it('Home/End = đầu/cuối dòng; Ctrl+Home/End = ô đầu/cuối bảng', () => {
    expect(nav(at(2, 1), 'Home')).toEqual(at(2, 0));
    expect(nav(at(2, 1), 'End')).toEqual(at(2, 2));
    expect(nav(at(2, 1), 'Home', true)).toEqual(at(0, 0));
    expect(nav(at(2, 1), 'End', true)).toEqual(at(3, 2));
  });
  it('phím khác (Tab, Space, chữ) → null để trình duyệt xử lý', () => {
    for (const k of ['Tab', ' ', 'Enter', 'a', 'Escape']) expect(nav(at(0, 0), k)).toBeNull();
  });
  it('bảng rỗng → null; vị trí lệch ngoài biên được kẹp lại', () => {
    expect(nextCell(at(0, 0), 'ArrowDown', { rows: 0, cols: 3 }, false)).toBeNull();
    expect(nav(at(9, 9), 'ArrowUp')).toEqual(at(2, 2));
  });
});
