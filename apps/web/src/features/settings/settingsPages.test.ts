import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** 11 route của Cài đặt → file trang + cỡ khung (B-D1: sm, riêng Quy trình và Vai trò & quyền là lg). */
const PAGES: [route: string, file: string, size: 'sm' | 'lg'][] = [
  ['general', 'features/settings/SettingsGeneralPage.tsx', 'sm'],
  ['notifications', 'features/settings/SettingsNotificationsPage.tsx', 'sm'],
  ['roles', 'features/settings/RolesPage.tsx', 'lg'],
  ['audit', 'features/audit/AuditLogPage.tsx', 'sm'],
  ['workflows', 'features/workflow-settings/WorkflowSettingsPage.tsx', 'lg'],
  ['priorities', 'features/settings/SettingsPrioritiesPage.tsx', 'sm'],
  ['severities', 'features/settings/SettingsSeveritiesPage.tsx', 'sm'],
  ['fields', 'features/settings/SettingsFieldsPage.tsx', 'sm'],
  ['response-time', 'features/sla/SlaPage.tsx', 'sm'],
  ['import', 'features/import/ImportPage.tsx', 'sm'],
  ['api', 'features/api-keys/ApiKeysPage.tsx', 'sm'],
];

describe('trang Cài đặt dùng PageFrame + PageHeader (T4)', () => {
  it.each(PAGES)(
    '%s: một khung đúng cỡ, có PageHeader, không h1 tay, không pageContainer',
    (_r, file, size) => {
      const s = src(file);
      expect(s).toMatch(new RegExp(`<PageFrame size="${size}">`));
      expect(s).toMatch(/<PageHeader\b/);
      expect(s).not.toMatch(/<h1\b/);
      expect(s).not.toMatch(/pageContainer/);
      expect(s).not.toMatch(/\bmax-w-(3xl|4xl|5xl|7xl)\b/);
    },
  );
  it('trang trong SubNavLayout không tự truyền back (layout vẽ "‹ Cài đặt")', () => {
    for (const [, file] of PAGES) expect(src(file), file).not.toMatch(/\bback=\{/);
  });
  it('PageShell cũ đã xoá', () => {
    expect(existsSync(join(root, 'features/settings/PageShell.tsx'))).toBe(false);
  });
  it('nút "Tạo vai trò" của trang nằm trong PageHeader.actions và giữ data-tour="roles-create"', () => {
    expect(src('features/settings/RolesPage.tsx')).toMatch(
      /<PageHeader[\s\S]*?actions=\{[\s\S]*?data-tour="roles-create"[\s\S]*?\/>\s*\{!canManage/,
    );
  });
  it('"Thêm cam kết" nằm trong PageHeader.actions; hộp thoại do trang điều khiển', () => {
    const s = src('features/sla/SlaPage.tsx');
    expect(s).toMatch(/<PageHeader[\s\S]*?actions=\{[\s\S]*?Thêm cam kết/);
    expect(s).toMatch(
      /<SlaPolicies canManage=\{canManage\} open=\{open\} onOpenChange=\{setOpen\}/,
    );
  });
  it('nút tạo trong EmptyState là secondary (B-D6)', () => {
    for (const f of [
      'features/settings/SeveritySection.tsx',
      'features/settings-admin/PrioritiesSection.tsx',
      'features/settings-admin/CustomFieldsAdminSection.tsx',
      'features/settings/RolesPage.tsx',
    ])
      expect(src(f), f).toMatch(/action=\{[\s\S]{0,120}?<Button variant="secondary" size="sm"/);
  });
  it('thẻ trong Cài đặt không lặp tiêu đề trang (không còn title={SETTINGS_LABELS.…} ở SectionCard)', () => {
    for (const f of [
      'features/settings/SeveritySection.tsx',
      'features/settings-admin/PrioritiesSection.tsx',
      'features/settings-admin/CustomFieldsAdminSection.tsx',
      'features/workspace/WorkspaceBrandingPanel.tsx',
    ])
      expect(src(f), f).not.toMatch(/SETTINGS_LABELS/);
  });
});
