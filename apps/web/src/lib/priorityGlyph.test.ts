import { describe, expect, it } from 'vitest';
import { priorityGlyph } from './priorityGlyph';

describe('priorityGlyph', () => {
  const five = [1, 2, 3, 4, 5];
  it('5 mức mặc định → 5 glyph theo thứ tự', () => {
    expect(five.map((r) => priorityGlyph(r, five))).toEqual([
      'lowest',
      'low',
      'medium',
      'high',
      'highest',
    ]);
  });
  it('3 mức → thấp/trung bình/cao', () => {
    expect([10, 20, 30].map((r) => priorityGlyph(r, [30, 10, 20]))).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });
  it('1 mức → medium; danh sách rỗng hoặc rank lạ → medium', () => {
    expect(priorityGlyph(7, [7])).toBe('medium');
    expect(priorityGlyph(3, [])).toBe('medium');
    expect(priorityGlyph(99, five)).toBe('medium');
  });
  it('7 mức: hai đầu là highest/lowest, giữa là medium', () => {
    const seven = [1, 2, 3, 4, 5, 6, 7];
    expect(priorityGlyph(7, seven)).toBe('highest');
    expect(priorityGlyph(1, seven)).toBe('lowest');
    expect(priorityGlyph(4, seven)).toBe('medium');
  });
  it('2 mức → thấp/cao; hạng trùng được gộp', () => {
    expect([1, 2].map((r) => priorityGlyph(r, [1, 2]))).toEqual(['low', 'high']);
    expect(priorityGlyph(5, [1, 1, 5, 5])).toBe('high');
  });
});
