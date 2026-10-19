import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextTabIndex, tabIds } from './Tabs';

describe('tabIds', () => {
  it('cặp tab ↔ panel ổn định theo idBase', () => {
    expect(tabIds('roles', 'custom')).toEqual({ tab: 'roles-tab-custom', panel: 'roles-panel' });
  });
});

describe('nextTabIndex — tablist ngang, kích hoạt tự động', () => {
  const none = [false, false, false];
  it('←/→ vòng tròn', () => {
    expect(nextTabIndex('ArrowRight', 2, none)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, none)).toBe(2);
    expect(nextTabIndex('ArrowRight', 0, none)).toBe(1);
  });
  it('Home/End', () => {
    expect(nextTabIndex('Home', 2, none)).toBe(0);
    expect(nextTabIndex('End', 0, none)).toBe(2);
  });
  it('↑/↓ và phím khác không điều hướng (khác radiogroup)', () => {
    expect(nextTabIndex('ArrowDown', 0, none)).toBeNull();
    expect(nextTabIndex('ArrowUp', 1, none)).toBeNull();
    expect(nextTabIndex('Enter', 0, none)).toBeNull();
  });
  it('bỏ qua tab bị tắt', () => {
    expect(nextTabIndex('ArrowRight', 0, [false, true, false])).toBe(2);
    expect(nextTabIndex('Home', 2, [true, false, false])).toBe(1);
    expect(nextTabIndex('ArrowRight', 0, [false, true, true])).toBeNull();
  });
});

const root = join(__dirname, '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

describe('không còn tablist tự vẽ', () => {
  /** Allow-list: file → lý do vẫn tự viết `role="tablist"`. Hiện rỗng: mọi hàng tab đều dùng `Tabs`. */
  const ALLOW: Record<string, string> = {};
  it('`role="tablist"` chỉ nằm trong components/ui/Tabs.tsx (hoặc allow-list có lý do)', () => {
    const found = walk(root)
      .map((f) => f.slice(root.length + 1))
      .filter((rel) => rel !== 'components/ui/Tabs.tsx')
      .filter((rel) => /role="tablist"/.test(src(rel)))
      .filter((rel) => !(rel in ALLOW));
    expect(found).toEqual([]);
  });
  it('một kiểu tab duy nhất (gạch chân): không còn variant pill; Hệ thống dùng mặc định (RA4)', () => {
    expect(src('components/ui/Tabs.tsx')).not.toMatch(/variant|pill/);
    expect(src('features/admin/AdminSystemPage.tsx')).not.toMatch(/variant="pill"/);
  });
  it('Tabs có tablist/tab/tabpanel, aria-controls/labelledby, roving tabindex, aria-selected', () => {
    const t = src('components/ui/Tabs.tsx');
    for (const needle of [
      'role="tablist"',
      'role="tab"',
      'role="tabpanel"',
      'aria-controls',
      'aria-labelledby',
      'aria-selected',
      'tabIndex',
      'nextTabIndex',
    ])
      expect(t).toContain(needle);
  });
  it.each([
    'features/settings/RolesPage.tsx',
    'features/resources/ResourcesPage.tsx',
    'features/admin/AdminSystemPage.tsx',
    'features/wiki/WikiHistoryDialog.tsx',
    'features/raid/RaidPage.tsx',
    'features/members/MembersPage.tsx',
    'features/portfolio/PortfolioPage.tsx',
    'features/automation/AutomationPage.tsx',
    'features/reports/ReportsPage.tsx',
    'features/notifications/NotificationsPage.tsx',
    'features/board/BoardSettingsDialog.tsx',
  ])('%s dùng <Tabs', (f) => {
    expect(src(f)).toMatch(/<Tabs\b/);
  });
  it('WorkflowSettingsPage: nút chuyển Sơ đồ/Danh sách là lựa chọn loại trừ → SegmentedControl, không tablist', () => {
    const w = src('features/workflow-settings/WorkflowSettingsPage.tsx');
    expect(w).toMatch(/<SegmentedControl[\s\S]*Kiểu xem quy trình/);
    expect(w).not.toContain('role="tab');
  });
  it('BoardSettingsDialog: Cài đặt bảng là tab (không còn SegmentedControl cho mục cài đặt)', () => {
    const b = src('features/board/BoardSettingsDialog.tsx');
    expect(b).toMatch(/<Tabs[^>]*\n?[^>]*ariaLabel="Mục cài đặt bảng"/);
    expect(b).not.toMatch(/<SegmentedControl[^>]*ariaLabel="Mục cài đặt bảng"/);
  });
});
