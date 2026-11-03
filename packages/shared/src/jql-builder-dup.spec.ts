import { describe, expect, it } from 'vitest';
import {
  findDuplicateConditions,
  serializeSimpleQuery,
  type SimpleCondition,
  type SimpleQuery,
} from './jql-builder';

const c = (id: string, over: Partial<SimpleCondition>): SimpleCondition => ({
  id,
  field: 'project',
  operator: 'IN',
  values: ['QLRV'],
  ...over,
});
const q = (conditions: SimpleCondition[]): SimpleQuery => ({
  combinator: 'AND',
  conditions,
  sort: null,
});

describe('điều kiện trùng trong bộ dựng truy vấn (logbug #18)', () => {
  it('Dự án = QLRV thêm hai lần → dòng thứ hai bị đánh dấu trùng với dòng 1, JQL chỉ có một mệnh đề', () => {
    const query = q([c('a', {}), c('b', {})]);
    expect([...findDuplicateConditions(query.conditions)]).toEqual([['b', 1]]);
    expect(serializeSimpleQuery(query)).toBe('project IN ("QLRV")');
  });
  it('IN không phân biệt thứ tự/hoa thường; khác giá trị hoặc toán tử thì không trùng', () => {
    expect(
      findDuplicateConditions([
        c('a', { values: ['A', 'B'] }),
        c('b', { values: ['b', 'a'] }),
        c('c', { values: ['A'] }),
        c('d', { operator: 'NOT IN', values: ['A', 'B'] }),
      ]).size,
    ).toBe(1);
  });
  it('dòng chưa điền xong không bị coi là trùng; IS EMPTY lặp thì trùng', () => {
    expect(findDuplicateConditions([c('a', { values: [] }), c('b', { values: [] })]).size).toBe(0);
    expect(
      findDuplicateConditions([
        c('a', { operator: 'IS', values: [] }),
        c('b', { operator: 'IS', values: [] }),
      ]).size,
    ).toBe(1);
  });
});
