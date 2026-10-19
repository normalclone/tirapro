import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** 5 route của Quản trị hệ thống (ngoài SubNavLayout; sidebar app đổi chế độ admin). Tất cả `lg` (B-D1). */
const PAGES: [route: string, file: string][] = [
  ['overview', 'features/admin/AdminOverviewPage.tsx'],
  ['workspaces', 'features/admin/AdminWorkspacesPage.tsx'],
  ['accounts', 'features/admin/AdminUsersPage.tsx'],
  ['config', 'features/admin/AdminConfigPage.tsx'],
  ['system', 'features/admin/AdminSystemPage.tsx'],
];

describe('trang Quản trị hệ thống dùng PageFrame lg + PageHeader (T7)', () => {
  it.each(PAGES)(
    '%s: PageFrame lg, PageHeader, không h1 tay/pageContainer/max-w/icon cạnh tiêu đề',
    (_r, file) => {
      const s = src(file);
      expect(s).toMatch(/<PageFrame size="lg">/);
      expect(s).toMatch(/<PageHeader\b/);
      expect(s).not.toMatch(/<h1\b|pageContainer|ShieldCheck/);
      expect(s).not.toMatch(/\bmax-w-(3xl|4xl|5xl|7xl)\b/);
      expect(s).not.toMatch(/\bback=\{/);
    },
  );
  it('Tài khoản: nút "Tạo tài khoản" nằm trong PageHeader.actions', () => {
    const s = src('features/admin/AdminUsersPage.tsx');
    const start = s.indexOf('<PageHeader');
    expect(s.slice(start, s.indexOf('\n      />', start))).toMatch(
      /actions=\{[\s\S]*Tạo tài khoản/,
    );
  });
  it('Tổng quan: "làm mới" là nút icon có tooltip "Làm mới · <thời gian>" và tên truy cập trùng', () => {
    const s = src('features/admin/AdminOverviewPage.tsx');
    expect(s).toContain('`Làm mới · ${relTime(data.generatedAt)}`');
    expect(s).toMatch(
      /size="icon"[\s\S]{0,200}title=\{refreshLabel\}[\s\S]{0,40}aria-label=\{refreshLabel\}/,
    );
    expect(s).not.toMatch(/\{data \? relTime\(data\.generatedAt\) : 'Làm mới'\}/);
  });
  it('Tổng quan: nút làm mới báo đang tải bằng aria-busy (RB6)', () => {
    expect(src('features/admin/AdminOverviewPage.tsx')).toMatch(
      /aria-busy=\{isFetching \|\| undefined\}/,
    );
  });
  it('Cấu hình: nhánh lỗi/đang tải cũng có tiêu đề (đúng một h1 mỗi route)', () => {
    const s = src('features/admin/AdminConfigPage.tsx');
    expect(s.match(/<PageFrame size="lg">/g)).toHaveLength(3);
    expect(s.match(/\{header\}/g)).toHaveLength(3);
  });
  it('Hệ thống giữ tab gạch chân "Loại nhật ký" ngay cạnh tiêu đề nhật ký (phần A)', () => {
    const s = src('features/admin/AdminSystemPage.tsx');
    expect(s).toMatch(
      /<h2[^>]*>Nhật ký kiểm toán · gần đây<\/h2>\s*<Tabs[\s\S]{0,80}ariaLabel="Loại nhật ký"/,
    );
  });
});
