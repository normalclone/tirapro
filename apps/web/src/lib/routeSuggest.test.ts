import { describe, expect, it } from 'vitest';
import { levenshtein, suggestRoutes, ROUTE_CATALOG } from './routeSuggest';

describe('levenshtein', () => {
  it('đếm đúng phép sửa', () => {
    expect(levenshtein('projcts', 'projects')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('wiki', 'wiki')).toBe(0);
  });
});

describe('suggestRoutes', () => {
  it('gõ sai một chữ → gợi ý đúng trang', () => {
    expect(suggestRoutes('/projcts')[0]?.path).toBe('/projects');
    expect(suggestRoutes('/setings/roles')[0]?.path).toBe('/settings');
  });
  it('không gợi ý bừa khi khác xa', () => {
    expect(suggestRoutes('/zzzzzzzz')).toEqual([]);
  });
  it('tối đa 3 mục và không chứa trùng lặp', () => {
    const r = suggestRoutes('/m');
    expect(r.length).toBeLessThanOrEqual(3);
    expect(new Set(r.map((x) => x.path)).size).toBe(r.length);
  });
  it('danh mục không chứa route quản trị', () => {
    expect(ROUTE_CATALOG.some((r) => r.path.startsWith('/admin'))).toBe(false);
  });
});
