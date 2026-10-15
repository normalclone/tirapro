import { describe, expect, it } from 'vitest';
import { parseJql } from '@tirapro/shared';
import { collectFulltextTerms, compileJql, primaryFulltextTerm } from './jql-compiler';

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

  it('có kết quả full-text -> where id in ids; `!~` vẫn dùng contains', () => {
    const fulltext = new Map([['foo', ['I1', 'I2']]]);
    expect(compileJql(ast('text ~ "foo"'), { currentUserId: 'U', fulltext }).where).toEqual({
      id: { in: ['I1', 'I2'] },
    });
    const neg = compileJql(ast('text !~ "foo"'), { currentUserId: 'U', fulltext }).where;
    expect(JSON.stringify(neg)).toContain('contains');
  });

  it('không có kết quả full-text (thiếu searchVector) -> contains summary/description như cũ', () => {
    const w = compileJql(ast('text ~ "foo"'), { currentUserId: 'U' }).where;
    expect(w).toEqual({
      OR: [
        { summary: { contains: 'foo', mode: 'insensitive' } },
        { description: { contains: 'foo', mode: 'insensitive' } },
      ],
    });
  });
});
