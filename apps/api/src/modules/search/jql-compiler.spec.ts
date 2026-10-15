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

  const like = (v: string) => ({ contains: v, mode: 'insensitive' });
  const matchOr = (v: string, ids: string[] = []) => ({
    OR: [
      ...(ids.length ? [{ id: { in: ids } }] : []),
      { summary: like(v) },
      { AND: [{ description: { not: null } }, { description: like(v) }] },
      { key: like(v) },
    ],
  });

  it('text ~ có kết quả xếp hạng => OR (id in ranked | summary/description/key contains) — không phụ thuộc top-200', () => {
    const fulltext = new Map([['foo', ['I1']]]);
    const { where } = compileJql(ast('text ~ "foo"'), { currentUserId: 'u', fulltext });
    expect(where).toEqual(matchOr('foo', ['I1']));
  });

  it('`!~` và NOT (text ~ …) đều là NOT của đúng điều kiện `~` (phần bù chính xác)', () => {
    const fulltext = new Map([['foo', ['I1', 'I2']]]);
    const ctx = { currentUserId: 'U', fulltext };
    expect(compileJql(ast('text !~ "foo"'), ctx).where).toEqual({
      NOT: matchOr('foo', ['I1', 'I2']),
    });
    expect(compileJql(ast('NOT (text ~ "foo")'), ctx).where).toEqual({
      NOT: matchOr('foo', ['I1', 'I2']),
    });
    // không có `~` cùng term => chỉ phủ định phần chuỗi con
    expect(compileJql(ast('text !~ "bar"'), { currentUserId: 'U' }).where).toEqual({
      NOT: matchOr('bar'),
    });
  });

  it('description NULL: điều kiện khớp không bao giờ NULL (chặn bằng description not null) => NOT không làm rơi issue', () => {
    const { where } = compileJql(ast('text ~ "foo"'), { currentUserId: 'U' });
    const json = JSON.stringify(where);
    expect(json).toContain('{"AND":[{"description":{"not":null}},{"description":{"contains":"foo"');
  });

  it('escape % _ \\ cho contains (Prisma không tự escape), nhưng tra full-text bằng giá trị gốc', () => {
    for (const [raw, escaped] of [
      ['_', '\\_'],
      ['%', '\\%'],
      ['50%', '50\\%'],
      ['a_b', 'a\\_b'],
      ['a\\b', 'a\\\\b'],
    ] as const) {
      const jql = `text ~ "${raw.replace(/\\/g, '\\\\')}"`;
      const fulltext = new Map([[raw, ['I1']]]);
      const { where } = compileJql(ast(jql), { currentUserId: 'U', fulltext });
      expect(where).toEqual({
        OR: [
          { id: { in: ['I1'] } }, // tra bằng v gốc (chưa escape) nên vẫn có id xếp hạng
          { summary: like(escaped) },
          { AND: [{ description: { not: null } }, { description: like(escaped) }] },
          { key: like(escaped) },
        ],
      });
    }
  });

  it('không có kết quả full-text (thiếu searchVector) -> contains summary/description/key', () => {
    const w = compileJql(ast('text ~ "foo"'), { currentUserId: 'U' }).where;
    expect(w).toEqual(matchOr('foo'));
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
