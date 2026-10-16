import { describe, expect, it } from 'vitest';
import { collapseSame, diffLines } from './textDiff';

const ops = (a: string, b: string) => diffLines(a, b).map((l) => `${l.op[0]}:${l.text}`);

describe('diffLines', () => {
  it('giống hệt => toàn "same"', () => expect(ops('a\nb', 'a\nb')).toEqual(['s:a', 's:b']));
  it('thêm một dòng giữa', () => expect(ops('a\nc', 'a\nb\nc')).toEqual(['s:a', 'a:b', 's:c']));
  it('xoá một dòng', () => expect(ops('a\nb\nc', 'a\nc')).toEqual(['s:a', 'd:b', 's:c']));
  it('đổi một dòng = xoá + thêm, đúng thứ tự', () =>
    expect(ops('a\nb\nc', 'a\nB\nc')).toEqual(['s:a', 'd:b', 'a:B', 's:c']));
  it('bản cũ rỗng => toàn thêm; bản mới rỗng => toàn xoá', () => {
    expect(ops('', 'x\ny')).toEqual(['a:x', 'a:y']);
    expect(ops('x\ny', '')).toEqual(['d:x', 'd:y']);
    expect(ops('', '')).toEqual([]);
  });
  it('chèn ở đầu và cuối', () => expect(ops('b', 'a\nb\nc')).toEqual(['a:a', 's:b', 'a:c']));
  it('quá lớn (vượt maxCells) => xoá hết rồi thêm hết, không treo', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`).join('\n');
    const r = diffLines(a, b, 100);
    expect(r.filter((l) => l.op === 'del')).toHaveLength(50);
    expect(r.filter((l) => l.op === 'add')).toHaveLength(50);
  });
});

describe('collapseSame', () => {
  it('giữ 2 dòng ngữ cảnh quanh thay đổi, gom phần giữa thành skip', () => {
    const lines = diffLines(
      ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n'),
      ['1', '2', '3', '4', '5', '6', 'X', '8'].join('\n'),
    );
    const out = collapseSame(lines, 2);
    expect(out[0]).toEqual({ op: 'skip', count: 4 }); // 1..4 gộp
    expect(out.slice(1).map((l) => ('text' in l ? `${l.op[0]}:${l.text}` : 'skip'))).toEqual([
      's:5',
      's:6',
      'd:7',
      'a:X',
      's:8',
    ]);
  });
  it('không đổi gì => một skip duy nhất; ít hơn ngưỡng thì không gom', () => {
    expect(collapseSame(diffLines('a\nb', 'a\nb'), 2)).toEqual([{ op: 'skip', count: 2 }]);
    expect(collapseSame(diffLines('a\nb', 'a\nc'), 2).some((l) => l.op === 'skip')).toBe(false);
  });
});
