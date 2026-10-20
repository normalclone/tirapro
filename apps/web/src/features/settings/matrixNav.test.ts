import { describe, expect, it } from 'vitest';
import { clampCell, isTabStop, nextCell, type NavMods } from './matrixNav';

const at = (r: number, c: number) => ({ r, c });
const nav = (p: { r: number; c: number }, key: string, ctrl = false, mods: NavMods = {}) =>
  nextCell(p, key, { rows: 4, cols: 3 }, { ...mods, ctrl });

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
    expect(nextCell(at(0, 0), 'ArrowDown', { rows: 0, cols: 3 }, {})).toBeNull();
    expect(nav(at(9, 9), 'ArrowUp')).toEqual(at(2, 2));
  });
});

describe('phím bổ trợ (không nuốt phím tắt của trình duyệt)', () => {
  it('Alt/Meta + mũi tên (lùi/tiến của trình duyệt) → null', () => {
    expect(nav(at(1, 1), 'ArrowLeft', false, { alt: true })).toBeNull();
    expect(nav(at(1, 1), 'ArrowRight', false, { alt: true })).toBeNull();
    expect(nav(at(1, 1), 'ArrowLeft', false, { meta: true })).toBeNull();
    expect(nav(at(1, 1), 'Home', false, { meta: true })).toBeNull();
  });
  it('Shift/Ctrl + mũi tên → null (chọn chữ, đổi tab…)', () => {
    expect(nav(at(1, 1), 'ArrowDown', false, { shift: true })).toBeNull();
    expect(nav(at(1, 1), 'ArrowDown', true)).toBeNull();
  });
  it('Shift + Home/End vẫn đi về đầu/cuối dòng; Ctrl + Home/End về góc lưới', () => {
    expect(nav(at(2, 1), 'Home', false, { shift: true })).toEqual(at(2, 0));
    expect(nav(at(2, 1), 'End', true)).toEqual(at(3, 2));
  });
});

describe('clampCell / isTabStop — luôn đúng MỘT điểm dừng Tab khi lưới co lại', () => {
  it('kẹp vị trí về trong lưới mới', () => {
    expect(clampCell(at(9, 7), { rows: 4, cols: 3 })).toEqual(at(3, 2));
    expect(clampCell(at(1, 1), { rows: 4, cols: 3 })).toEqual(at(1, 1));
  });
  it('lưới rỗng → {0,0} (không âm)', () => {
    expect(clampCell(at(5, 5), { rows: 0, cols: 0 })).toEqual(at(0, 0));
  });
  it('sau khi co lại (dòng/cột cuối biến mất) vẫn đúng một ô có tabIndex 0', () => {
    for (const size of [
      { rows: 4, cols: 3 },
      { rows: 2, cols: 3 },
      { rows: 4, cols: 1 },
      { rows: 1, cols: 1 },
    ]) {
      let stops = 0;
      for (let r = 0; r < size.rows; r++)
        for (let c = 0; c < size.cols; c++) if (isTabStop(at(9, 9), size, r, c)) stops++;
      expect(stops).toBe(1);
    }
  });
});
