import { describe, expect, it } from 'vitest';
import {
  levenshtein,
  projectKeyOf,
  suggestProjectViews,
  suggestRoutes,
  ROUTE_CATALOG,
  type RouteEntry,
} from './routeSuggest';

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

describe('suggestRoutes — bỏ dấu, từ khoá, chính nó, % lỗi', () => {
  const catalog: RouteEntry[] = [
    { path: '/nhat-ky', label: 'Nhật ký', keywords: ['audit log'] },
    { path: '/wiki', label: 'Wiki', keywords: ['tai lieu'] },
  ];
  it('gõ không dấu khớp nhãn có dấu (nhat ky ↔ Nhật ký)', () => {
    expect(suggestRoutes('/nhat', catalog)[0]?.path).toBe('/nhat-ky');
    expect(suggestRoutes('/Nhật', catalog)[0]?.path).toBe('/nhat-ky');
  });
  it('khớp theo từ khoá phụ', () => {
    expect(suggestRoutes('/audit', catalog)[0]?.path).toBe('/nhat-ky');
    expect(suggestRoutes('/tai', catalog)[0]?.path).toBe('/wiki');
  });
  it('không bao giờ gợi ý chính đường dẫn đang gõ', () => {
    expect(suggestRoutes('/wiki', catalog).map((r) => r.path)).not.toContain('/wiki');
  });
  it('chuỗi % hỏng không ném lỗi (decodeURIComponent lỗi → dùng nguyên chuỗi)', () => {
    expect(() => suggestRoutes('/%E0%A4%A', catalog)).not.toThrow();
    expect(suggestRoutes('/%E0%A4%A', catalog)).toEqual([]);
  });
  it('đường dẫn rỗng → không gợi ý', () => {
    expect(suggestRoutes('/', catalog)).toEqual([]);
  });
});

describe('projectKeyOf / suggestProjectViews — 404 trong dự án', () => {
  it('lấy mã dự án từ /p/KEY/…', () => {
    expect(projectKeyOf('/p/DEMO/khong-co')).toBe('DEMO');
    expect(projectKeyOf('/p/DEMO')).toBe('DEMO');
    expect(projectKeyOf('/p/DEMO/')).toBe('DEMO');
    expect(projectKeyOf('/p/%E0%A4%A/x')).toBe('%E0%A4%A');
  });
  it('ngoài dự án → null', () => {
    expect(projectKeyOf('/projects')).toBeNull();
    expect(projectKeyOf('/p')).toBeNull();
    expect(projectKeyOf('/wiki/p/x')).toBeNull();
  });
  it('gợi ý màn trong dự án theo đoạn thứ ba, đường dẫn giữ mã dự án', () => {
    expect(suggestProjectViews('/p/DEMO/bakclog')[0]).toMatchObject({ path: '/p/DEMO/backlog' });
    expect(suggestProjectViews('/p/DEMO/bao')[0]?.path).toBe('/p/DEMO/reports');
  });
  it('không gợi ý chính đường dẫn; không gợi ý bừa; ngoài dự án rỗng', () => {
    expect(suggestProjectViews('/p/DEMO/board').map((r) => r.path)).not.toContain('/p/DEMO/board');
    expect(suggestProjectViews('/p/DEMO/zzzzzzzz')).toEqual([]);
    expect(suggestProjectViews('/wiki')).toEqual([]);
  });
});
