import { describe, expect, it } from 'vitest';
import { nextRadioIndex } from './radioNav';

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
