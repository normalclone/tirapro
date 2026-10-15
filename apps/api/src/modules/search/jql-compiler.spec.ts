import { describe, expect, it } from 'vitest';
import { parseJql } from '@tirapro/shared';
import {
  collectFulltextTerms,
  compileJql,
  primaryFulltextTerm,
  topLevelProjectKeys,
} from './jql-compiler';

const ast = (jql: string) => parseJql(jql);

describe('JQL text ~ (full-text)', () => {
  it('collectFulltextTerms chỉ lấy `text ~` không rỗng, khử trùng', () => {
    const a = ast(
      'text ~ "lỗi đăng nhập" AND (text ~ "lỗi đăng nhập" OR text ~ "abc") AND text !~ "xyz" AND summary ~ "q"',
    );
    expect(collectFulltextTerms(a.where).sort()).toEqual(['abc', 'lỗi đăng nhập']);
    expect(collectFulltextTerms(ast('text ~ ""').where)).toEqual([]);
  });

  it('primaryFulltextTerm: có trên chuỗi AND, không có khi nằm dưới OR/NOT', () => {
    expect(primaryFulltextTerm(ast('project = ABC AND text ~ "foo"').where)).toBe('foo');
    expect(primaryFulltextTerm(ast('text ~ "foo" OR project = ABC').where)).toBeNull();
    expect(primaryFulltextTerm(ast('NOT (text ~ "foo")').where)).toBeNull();
  });

  it('text ~ có kết quả xếp hạng => OR (id in ranked | summary/description/key contains) — không phụ thuộc top-200', () => {
    const fulltext = new Map([['foo', ['I1']]]);
    const { where } = compileJql(ast('text ~ "foo"'), { currentUserId: 'u', fulltext });
    expect(where).toEqual({
      OR: [
        { id: { in: ['I1'] } },
        { summary: { contains: 'foo', mode: 'insensitive' } },
        { description: { contains: 'foo', mode: 'insensitive' } },
        { key: { contains: 'foo', mode: 'insensitive' } },
      ],
    });
  });

  it('`!~` là NOT của cùng điều kiện contains (không dùng id xếp hạng)', () => {
    const fulltext = new Map([['foo', ['I1', 'I2']]]);
    const neg = compileJql(ast('text !~ "foo"'), { currentUserId: 'U', fulltext }).where;
    expect(neg).toEqual({
      NOT: {
        OR: [
          { summary: { contains: 'foo', mode: 'insensitive' } },
          { description: { contains: 'foo', mode: 'insensitive' } },
          { key: { contains: 'foo', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('không có kết quả full-text (thiếu searchVector) -> contains summary/description/key', () => {
    const w = compileJql(ast('text ~ "foo"'), { currentUserId: 'U' }).where;
    expect(w).toEqual({
      OR: [
        { summary: { contains: 'foo', mode: 'insensitive' } },
        { description: { contains: 'foo', mode: 'insensitive' } },
        { key: { contains: 'foo', mode: 'insensitive' } },
      ],
    });
  });

  it('topLevelProjectKeys: lấy project = / IN trên chuỗi AND; bỏ qua khi nằm trong OR/NOT', () => {
    expect(topLevelProjectKeys(ast('project = ABC AND text ~ "x"').where)).toEqual(['ABC']);
    expect(topLevelProjectKeys(ast('project IN (A, B) AND status = Done').where)).toEqual([
      'A',
      'B',
    ]);
    expect(topLevelProjectKeys(ast('project = A OR text ~ "x"').where)).toBeNull();
    expect(topLevelProjectKeys(ast('NOT (project = A)').where)).toBeNull();
    expect(topLevelProjectKeys(ast('status = Done').where)).toBeNull();
  });
});
