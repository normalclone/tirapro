import { describe, expect, it } from 'vitest';
import {
  availableToAdd,
  withComponent,
  withoutComponent,
  withVersion,
  withoutVersion,
} from './issueSets';

const c = (id: string, name = id) => ({ id, name });
const v = (id: string, type: 'FIX' | 'AFFECTS', name = id) => ({ id, name, type });

describe('thành phần', () => {
  it('thêm khử trùng, giữ thứ tự theo tên', () => {
    expect(withComponent([c('b', 'Web')], c('a', 'API'))).toEqual([c('a', 'API'), c('b', 'Web')]);
    expect(withComponent([c('a')], c('a'))).toEqual([c('a')]);
  });
  it('bỏ: có và không có', () => {
    expect(withoutComponent([c('a'), c('b')], 'a')).toEqual([c('b')]);
    expect(withoutComponent([c('a')], 'zzz')).toEqual([c('a')]);
  });
});
describe('phiên bản (cùng phiên bản có thể vừa FIX vừa AFFECTS)', () => {
  it('khử trùng theo (id, type)', () => {
    expect(withVersion([v('x', 'FIX')], v('x', 'AFFECTS'))).toHaveLength(2);
    expect(withVersion([v('x', 'FIX')], v('x', 'FIX'))).toHaveLength(1);
  });
  it('bỏ theo (id, type) — không đụng loại còn lại', () => {
    expect(withoutVersion([v('x', 'FIX'), v('x', 'AFFECTS')], 'x', 'FIX')).toEqual([
      v('x', 'AFFECTS'),
    ]);
  });
});
describe('availableToAdd', () => {
  it('danh mục trừ phần đã gắn', () => {
    expect(availableToAdd([c('a'), c('b'), c('c')], [c('b')]).map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('phiên bản theo loại: đã gắn FIX vẫn thêm được AFFECTS', () => {
    const cat = [
      { id: 'x', name: 'x' },
      { id: 'y', name: 'y' },
    ];
    expect(availableToAdd(cat, [v('x', 'FIX')], 'FIX').map((i) => i.id)).toEqual(['y']);
    expect(availableToAdd(cat, [v('x', 'FIX')], 'AFFECTS').map((i) => i.id)).toEqual(['x', 'y']);
  });
});
