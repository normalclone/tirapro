import { describe, expect, it } from 'vitest';
import { nextEnabledRadioIndex, nextRadioIndex } from './radioNav';

describe('nextRadioIndex — điều hướng bàn phím của radiogroup', () => {
  it('mũi tên phải/xuống: tới mục kế, vòng về đầu', () => {
    expect(nextRadioIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextRadioIndex('ArrowDown', 2, 3)).toBe(0);
  });
  it('mũi tên trái/lên: lùi một mục, vòng về cuối', () => {
    expect(nextRadioIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextRadioIndex('ArrowUp', 0, 3)).toBe(2);
  });
  it('Home/End; phím khác hoặc nhóm rỗng → null', () => {
    expect(nextRadioIndex('Home', 2, 3)).toBe(0);
    expect(nextRadioIndex('End', 0, 3)).toBe(2);
    expect(nextRadioIndex('a', 0, 3)).toBeNull();
    expect(nextRadioIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('nextEnabledRadioIndex — bỏ qua mục vô hiệu', () => {
  const off = [false, true, false, true];
  it('mũi tên nhảy qua mục tắt, vòng tròn', () => {
    expect(nextEnabledRadioIndex('ArrowRight', 0, off)).toBe(2);
    expect(nextEnabledRadioIndex('ArrowRight', 2, off)).toBe(0);
    expect(nextEnabledRadioIndex('ArrowLeft', 0, off)).toBe(2);
    expect(nextEnabledRadioIndex('ArrowUp', 2, off)).toBe(0);
  });
  it('Home/End về mục bật đầu/cuối', () => {
    expect(nextEnabledRadioIndex('Home', 2, [true, false, false])).toBe(1);
    expect(nextEnabledRadioIndex('End', 0, off)).toBe(2);
  });
  it('không còn mục bật nào khác → null; phím khác → null', () => {
    expect(nextEnabledRadioIndex('ArrowRight', 0, [false, true, true])).toBeNull();
    expect(nextEnabledRadioIndex('ArrowRight', 0, [true, true])).toBeNull();
    expect(nextEnabledRadioIndex('Home', 0, [true, true])).toBeNull();
    expect(nextEnabledRadioIndex('a', 0, off)).toBeNull();
    expect(nextEnabledRadioIndex('ArrowRight', 0, [])).toBeNull();
  });
  it('không mục nào tắt → giống nextRadioIndex', () => {
    for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'x']) {
      expect(nextEnabledRadioIndex(k, 1, [false, false, false])).toBe(nextRadioIndex(k, 1, 3));
    }
  });
});
