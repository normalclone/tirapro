import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { boardVisualOrder } from './selectionOrder';

const i = (id: string) => ({ id }) as IssueDto;
const cols = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];

describe('boardVisualOrder (thứ tự DOM của thẻ trên bảng, cho Shift+click)', () => {
  it('bảng phẳng: từng cột từ trái sang phải, trong cột từ trên xuống', () => {
    const byColumn = new Map([
      ['c1', [i('a'), i('b')]],
      ['c2', [i('c')]],
      ['c3', [i('d'), i('e')]],
    ]);
    expect(boardVisualOrder(cols, byColumn, null, new Map())).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('cột không có việc / không có trong map được bỏ qua', () => {
    const byColumn = new Map([['c2', [i('x')]]]);
    expect(boardVisualOrder(cols, byColumn, null, new Map())).toEqual(['x']);
  });
  it('có làn: lần lượt từng làn, trong làn theo thứ tự cột', () => {
    const laneCols = new Map([
      [
        'L1',
        new Map([
          ['c1', [i('a')]],
          ['c3', [i('b')]],
        ]),
      ],
      ['L2', new Map([['c2', [i('c')]]])],
    ]);
    expect(boardVisualOrder(cols, new Map(), [{ key: 'L1' }, { key: 'L2' }], laneCols)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('làn thiếu trong map → bỏ qua, không ném', () => {
    expect(boardVisualOrder(cols, new Map(), [{ key: 'zz' }], new Map())).toEqual([]);
  });
});
