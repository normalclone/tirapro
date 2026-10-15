import { describe, expect, it } from 'vitest';
import { parseJql } from '@tirapro/shared';
import {
  collectFulltextTerms,
  compileJql,
  containsWhere,
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

  it('summary ~ / !~ (cột đơn): escape % _ \\, summary không nullable nên không thêm not null', () => {
    const ctx = { currentUserId: 'U' };
    expect(compileJql(ast('summary ~ "_"'), ctx).where).toEqual({ summary: like('\\_') });
    expect(compileJql(ast('summary ~ "50%"'), ctx).where).toEqual({ summary: like('50\\%') });
    expect(compileJql(ast('summary !~ "a_b"'), ctx).where).toEqual({
      NOT: { summary: like('a\\_b') },
    });
    expect(compileJql(ast('NOT (summary ~ "%")'), ctx).where).toEqual({
      NOT: { summary: like('\\%') },
    });
  });

  it('containsWhere: cột nullable (vd description) ~ "%" escape + chặn NULL; !~ là NOT của cùng điều kiện', () => {
    expect(containsWhere('description', '%', true)).toEqual({
      AND: [{ description: { not: null } }, { description: like('\\%') }],
    });
    expect(containsWhere('summary', '_')).toEqual({ summary: like('\\_') });
  });

  it('trường quan hệ (type/status/…): ~ và !~ cùng escape + không phân biệt hoa thường', () => {
    const ctx = { currentUserId: 'U' };
    expect(compileJql(ast('status ~ "50%"'), ctx).where).toEqual({
      status: { name: like('50\\%') },
    });
    expect(compileJql(ast('status !~ "a_b"'), ctx).where).toEqual({
      status: { name: { not: { contains: 'a\\_b' }, mode: 'insensitive' } },
    });
  });

  it('quan hệ nullable (priority/sprint/resolution): `!~` gồm cả issue không có quan hệ (phần bù đúng của `~`)', () => {
    const ctx = { currentUserId: 'U' };
    for (const [field, rel, id] of [
      ['priority', 'priority', 'priorityId'],
      ['sprint', 'sprint', 'sprintId'],
      ['resolution', 'resolution', 'resolutionId'],
    ] as const) {
      expect(compileJql(ast(`${field} !~ "a_b"`), ctx).where).toEqual({
        OR: [
          { [id]: null },
          { [rel]: { name: { not: { contains: 'a\\_b' }, mode: 'insensitive' } } },
        ],
      });
      // `~` giữ nguyên (Prisma tự thêm điều kiện quan hệ tồn tại)
      expect(compileJql(ast(`${field} ~ "a"`), ctx).where).toEqual({
        [rel]: { name: like('a') },
      });
    }
  });

  it('quan hệ bắt buộc (type/status/project): `!~` không thêm nhánh null', () => {
    const ctx = { currentUserId: 'U' };
    expect(compileJql(ast('type !~ "Bug"'), ctx).where).toEqual({
      type: { name: { not: { contains: 'Bug' }, mode: 'insensitive' } },
    });
  });
});

describe('JQL statusCategory — enum, không để Prisma ném 500 (Minor 7)', () => {
  const w = (jql: string) => compileJql(ast(jql), { currentUserId: 'u' }).where;

  it('=, !=, IN, NOT IN với giá trị đúng enum, không phân biệt hoa/thường', () => {
    expect(w('statusCategory = Done')).toEqual({ status: { category: 'DONE' } });
    expect(w('statusCategory = "in progress"')).toEqual({ status: { category: 'IN_PROGRESS' } });
    expect(w('statusCategory != todo')).toEqual({ status: { category: { not: 'TODO' } } });
    expect(w('statusCategory IN (todo, "In-Progress")')).toEqual({
      status: { category: { in: ['TODO', 'IN_PROGRESS'] } },
    });
    expect(w('statusCategory NOT IN (done)')).toEqual({
      status: { category: { notIn: ['DONE'] } },
    });
  });

  it('giá trị ngoài enum hoặc toán tử ~ / !~ => 422 (BusinessRule), không sinh where lỗi', () => {
    expect(() => w('statusCategory = Finished')).toThrowError(/không hợp lệ cho statusCategory/);
    expect(() => w('statusCategory ~ "do"')).toThrowError(/Toán tử ~ không dùng được/);
    expect(() => w('statusCategory !~ "do"')).toThrowError(/Toán tử !~ không dùng được/);
    try {
      w('statusCategory = x');
    } catch (e) {
      expect((e as { status?: number }).status).toBe(422);
    }
  });
});
