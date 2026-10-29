import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Trang workspace phẳng → cỡ khung (B-D1). */
const PAGES: [name: string, file: string, size: 'sm' | 'xl'][] = [
  ['Tổng quan', 'features/dashboard/DashboardPage.tsx', 'xl'],
  ['Bảng tổng quan (xem)', 'features/dashboards/DashboardViewPage.tsx', 'xl'],
  ['Bảng tổng quan (sửa)', 'features/dashboards/DashboardEditor.tsx', 'xl'],
  ['Dự án', 'features/projects/ProjectsPage.tsx', 'xl'],
  ['Thành viên', 'features/members/MembersPage.tsx', 'sm'],
  ['Thông báo', 'features/notifications/NotificationsPage.tsx', 'sm'],
  ['Tài khoản', 'features/members/AccountPage.tsx', 'sm'],
];

describe('trang workspace phẳng dùng PageFrame + PageHeader (T8)', () => {
  it.each(PAGES)(
    '%s: PageFrame đúng cỡ, PageHeader, không h1 tay/pageContainer/max-w',
    (_n, file, size) => {
      const s = src(file);
      expect(s).toMatch(new RegExp(`<PageFrame size="${size}"`));
      expect(s).toMatch(/<PageHeader\b/);
      expect(s).not.toMatch(/<h1\b|pageContainer/);
      expect(s).not.toMatch(/\bmax-w-(3xl|4xl|5xl|7xl)\b/);
    },
  );
  it('bốn chỗ cũ có py-6 giữ ghi đè đệm dọc (Tổng quan, xem, sửa)', () => {
    for (const f of [
      'features/dashboard/DashboardPage.tsx',
      'features/dashboards/DashboardViewPage.tsx',
      'features/dashboards/DashboardEditor.tsx',
    ])
      expect(src(f), f).toMatch(/<PageFrame size="xl" className="py-6">/);
  });
  it('nút chính nằm trong PageHeader.actions: Tạo dự án, Đánh dấu đã đọc tất cả, Chỉnh sửa bảng', () => {
    expect(src('features/projects/ProjectsPage.tsx')).toMatch(
      /<PageHeader[^>]*actions=\{createButton/,
    );
    const n = src('features/notifications/NotificationsPage.tsx');
    expect(
      n.slice(n.indexOf('<PageHeader'), n.indexOf('\n      />', n.indexOf('<PageHeader'))),
    ).toContain('Đánh dấu đã đọc tất cả');
    const v = src('features/dashboards/DashboardViewPage.tsx');
    expect(
      v.slice(v.indexOf('<PageHeader'), v.indexOf('\n      />', v.indexOf('<PageHeader'))),
    ).toContain('Chỉnh sửa');
  });
  it('xem bảng: breadcrumb "Tổng quan › tên" thay link "← Tổng quan"; bản in giữ print:hidden', () => {
    const v = src('features/dashboards/DashboardViewPage.tsx');
    expect(v).toMatch(
      /breadcrumb=\{\[\{ label: 'Tổng quan', to: '\/' \}, \{ label: dashboard\.name \}\]\}/,
    );
    expect(v).not.toMatch(/ArrowLeft/);
    expect(v).toMatch(/<PageHeader\s+className="print:hidden"/);
  });
  it('trình sửa bảng giữ guard rời trang (useLeaveGuard) và có tiêu đề riêng', () => {
    const e = src('features/dashboards/DashboardEditor.tsx');
    expect(e).toMatch(/useLeaveGuard\(\{\s*dirty,/);
    expect(e).toMatch(/Chỉnh sửa bảng tổng quan/);
  });
  it('Thành viên/Thông báo giữ Tabs idBase và neo tour members-*', () => {
    const m = src('features/members/MembersPage.tsx');
    expect(m).toMatch(/idBase="members"/);
    for (const t of ['members-tabs', 'members-list', 'members-add'])
      expect(m + src('features/members/AddMemberPanel.tsx')).toContain(`data-tour="${t}"`);
    expect(src('features/notifications/NotificationsPage.tsx')).toMatch(/idBase="notif"/);
  });
  it('Nhóm: SectionCard, nút "Tạo nhóm" ở actions, EmptyState secondary', () => {
    const t = src('features/teams/TeamsPanel.tsx');
    expect(t).toMatch(/<SectionCard\s+title="Nhóm"/);
    expect(t).not.toMatch(/<section className="rounded-lg/);
    expect(t).toMatch(
      /variant="secondary" size="sm" onClick=\{openCreate\}>\s*<Plus className="h-4 w-4" \/> Tạo nhóm/,
    );
  });
  it('nút tạo trong EmptyState là secondary: Dự án, Bảng tổng quan (xem + sửa)', () => {
    expect(src('features/projects/ProjectsPage.tsx')).toMatch(
      /variant="secondary" size="sm" onClick=\{\(\) => setCreateOpen\(true\)\}>\s*<Plus className="h-4 w-4" \/> Tạo dự án đầu tiên/,
    );
    for (const f of [
      'features/dashboards/DashboardViewPage.tsx',
      'features/dashboards/DashboardEditor.tsx',
    ])
      expect(src(f), f).toMatch(
        /<Button\s+variant="secondary"\s+size="sm"[\s\S]{0,120}Thêm widget/,
      );
  });
});
