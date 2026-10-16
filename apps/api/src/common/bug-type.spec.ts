import { describe, expect, it } from 'vitest';
import { BUG_TYPE_WHERE, bugTypeSql, isBugType } from './bug-type';

describe('bug-type — MỘT định nghĩa của "bug"', () => {
  it('isBugType: key BUG hoặc tên Bug (không phân biệt hoa thường)', () => {
    expect(isBugType({ key: 'BUG', name: 'Lỗi' })).toBe(true);
    expect(isBugType({ key: null, name: 'bug' })).toBe(true);
    expect(isBugType({ key: 'CUSTOM', name: 'BUG' })).toBe(true);
    expect(isBugType({ key: 'STORY', name: 'Story' })).toBe(false);
    expect(isBugType({})).toBe(false);
  });

  it('where Prisma và mảnh SQL cùng nghĩa', () => {
    expect(BUG_TYPE_WHERE).toEqual({
      OR: [{ key: 'BUG' }, { name: { equals: 'Bug', mode: 'insensitive' } }],
    });
    const sql = bugTypeSql('t').sql;
    expect(sql).toContain(`t."key" = 'BUG'`);
    expect(sql).toContain(`lower(t."name") = 'bug'`);
    expect(sql).not.toContain('::text');
  });
});
