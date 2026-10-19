import { describe, expect, it } from 'vitest';
import { collapseSame, diffLines } from './lineDiff';

describe('diffLines', () => {
  it('giống nhau → toàn dòng same', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ]);
  });
  it('thêm và xoá dòng giữ đúng thứ tự', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc\nd')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' },
    ]);
  });
  it('một bên rỗng', () => {
    expect(diffLines('', 'a')).toEqual([{ type: 'add', text: 'a' }]);
    expect(diffLines('a', '')).toEqual([{ type: 'del', text: 'a' }]);
    expect(diffLines('', '')).toEqual([]);
  });
  it('dòng trống ở giữa là một dòng thật', () => {
    expect(diffLines('a\n\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: '' },
      { type: 'same', text: 'b' },
    ]);
  });
  it('xuống dòng kiểu Windows được coi như \\n', () => {
    expect(diffLines('a\r\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ]);
  });
  it('quá lớn → null (không treo trình duyệt)', () => {
    const big = Array.from({ length: 2500 }, (_, i) => `d${i}`).join('\n');
    expect(diffLines(big, big + '\nx')).toBeNull();
  });
});

describe('collapseSame', () => {
  const same = (n: number, p = 's') =>
    Array.from({ length: n }, (_, i) => ({ type: 'same' as const, text: `${p}${i}` }));
  it('đoạn giống dài (> 6 dòng) thu gọn thành một mục "N dòng không đổi"', () => {
    const rows = [...same(10), { type: 'add' as const, text: 'x' }];
    expect(collapseSame(rows)).toEqual([{ type: 'skip', count: 10 }, rows[10]]);
  });
  it('đoạn giống ngắn (≤ 6 dòng) giữ nguyên', () => {
    const rows = [...same(6), { type: 'del' as const, text: 'y' }];
    expect(collapseSame(rows)).toEqual(rows);
  });
});
