import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('token vô hiệu', () => {
  it('khai báo ở cả 3 khối: sáng, tối, in', () => {
    expect(css.match(/--disabled-bg:/g)?.length).toBe(3);
    expect(css.match(/--disabled-fg:/g)?.length).toBe(3);
  });
  it.each([
    'components/ui/Button.tsx',
    'components/ui/Input.tsx',
    'components/ui/SearchSelect.tsx',
    'components/ui/PeoplePicker.tsx',
    'components/ui/RoleMultiSelect.tsx',
    'components/ui/DateInput.tsx',
  ])('%s không dùng opacity cho trạng thái vô hiệu', (p) => {
    expect(src(p)).not.toMatch(/disabled:opacity-/);
    expect(src(p)).toMatch(/disabled:bg-disabled-bg|disabled-bg/);
  });
  it('Button: hover thường (không enabled:hover) + selector vô hiệu thắng hover', () => {
    const btn = src('components/ui/Button.tsx');
    expect(btn).not.toContain('enabled:hover:');
    expect(btn).toContain('[&:disabled:not([aria-busy=true])]:bg-disabled-bg');
  });
  it('Button: nút đang tải giữ màu biến thể khi rê (aria-busy:hover: cho cả 5 biến thể)', () => {
    const btn = src('components/ui/Button.tsx');
    for (const re of [
      /primary:[^\n]*aria-busy:hover:bg-primary\b/,
      /secondary:[^\n]*aria-busy:hover:bg-surface-2/,
      /ghost:[^\n]*BUSY_NO_HOVER_FLAT/,
      /outline:[^\n]*BUSY_NO_HOVER_FLAT/,
      /danger:[^\n]*aria-busy:hover:opacity-100/,
    ])
      expect(btn).toMatch(re);
    expect(btn).toMatch(/BUSY_NO_HOVER_FLAT =\s*'aria-busy:hover:bg-transparent/);
  });
});

/** File đã chuyển sang token vô hiệu: không còn `disabled:opacity-`. */
const CONVERTED = [
  'features/project-config/GeneralSection.tsx',
  'features/project-config/DataSection.tsx',
  'features/issues/IssueDetailPage.tsx',
  'features/issues/peek/IssuePeekPanel.tsx',
  'features/issue-widgets/WatchButton.tsx',
  'features/backlog/StartSprintDialog.tsx',
  'features/issue-fields/CustomFieldsPanel.tsx', // chip nhãn (:383); checkbox native (:147) nằm trong ALLOW
  'features/auth/DemoAccounts.tsx',
  'features/workspace/WorkspaceOption.tsx', // mục không gian làm việc (tách từ WorkspaceSwitcher)
];

/**
 * `disabled:opacity-*` còn lại CÓ CHỦ ĐÍCH — file → lý do. Thêm chỗ mới phải thêm vào đây kèm lý do
 * (mặc định ô/nút/chip tự viết dùng `disabled:bg-disabled-bg disabled:text-disabled-fg disabled:cursor-not-allowed`).
 */
const ALLOW: Record<string, string> = {
  // icon-button / liên kết chữ không nền: token nền vô nghĩa, chỉ cần mờ đi
  'features/tree/TreePage.tsx': 'icon-button không nền',
  'features/wiki/WikiPage.tsx': 'icon-button không nền',
  'features/issue-edit/CommentsSection.tsx': 'liên kết chữ không nền',
  'features/issue-widgets/LinksPanel.tsx':
    'icon-button; đang `opacity-0 group-hover:opacity-100` nên đổi opacity là xung đột',
  'features/ai/AssigneeSuggestButton.tsx': 'nút chữ ghost không nền',
  'features/notifications/NotificationBell.tsx': 'nút chữ ghost không nền',
  'features/members/AddPeopleDialog.tsx': 'liên kết chữ không nền',
  'features/saved-filters/QueryBuilder.tsx': 'nút chữ ghost không nền',
  'features/issue-meta/IssueLabelsPicker.tsx': 'nút X nhỏ (icon-button không nền) trong chip nhãn',
  // checkbox native: trình duyệt tự vẽ, không tô lại được bằng nền/chữ
  'features/settings/RolesPage.tsx': 'checkbox native',
  // công tắc (switch): trạng thái bật/tắt phải còn đọc được khi vô hiệu
  'features/admin/AdminConfigPage.tsx': 'switch',
  'features/project-config/PrivacySection.tsx': 'switch',
  'features/digests/DigestsSection.tsx': 'switch',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

describe('disabled:opacity- ngoài primitive', () => {
  it.each(CONVERTED.filter((p) => p !== 'features/issue-fields/CustomFieldsPanel.tsx'))(
    '%s đã chuyển sang token, không còn disabled:opacity-',
    (p) => {
      expect(src(p)).not.toMatch(/disabled:opacity-/);
    },
  );
  it('CustomFieldsPanel: chip nhãn dùng token; chỉ còn opacity ở checkbox native', () => {
    const lines = src('features/issue-fields/CustomFieldsPanel.tsx')
      .split('\n')
      .filter((l) => /disabled:opacity-/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/type="checkbox"|accent-\[var\(--primary\)\]/);
  });
  it('chip bật/tắt (aria-pressed): nhánh "bật" có dáng vô hiệu riêng, nhánh "tắt" mới dùng token xám (RA3)', () => {
    for (const [p, onRe] of [
      [
        'features/issue-fields/CustomFieldsPanel.tsx',
        /on\s*\?\s*'[^']*disabled:bg-primary\/50[^']*disabled:text-primary-fg[^']*'/,
      ],
      [
        'features/backlog/StartSprintDialog.tsx',
        /active\s*\?\s*'[^']*disabled:border-primary\/40[^']*disabled:text-primary\/60[^']*'/,
      ],
    ] as const) {
      const code = src(p);
      expect(code, p).toMatch(onRe);
      // nhánh "bật" không bị token xám đè (twMerge lấy class cuối) và token xám nằm ở nhánh "tắt"
      const m = /(?:on|active)\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/.exec(code)!;
      expect(m[1], p).not.toMatch(/disabled:bg-disabled-bg/);
      expect(m[2], p).toMatch(/disabled:bg-disabled-bg/);
      expect(m[2], p).toMatch(/disabled:text-disabled-fg/);
    }
  });
  it('ô/nút/chip tự viết đã chuyển có đủ token vô hiệu', () => {
    for (const p of CONVERTED)
      expect(src(p), p).toMatch(/disabled[:_]\S*(bg-disabled-bg|text-disabled-fg)/);
  });
  it('không còn `disabled:opacity-` nào ngoài allow-list có lý do (chặn thêm mới)', () => {
    const root = join(__dirname, '..');
    const offenders = walk(root)
      .map((f) => f.slice(root.length + 1))
      .filter((rel) => !rel.startsWith('components/ui/')) // primitive đã có test riêng ở trên
      .filter((rel) => /disabled:opacity-/.test(src(rel)))
      .filter((rel) => !(rel in ALLOW) && rel !== 'features/issue-fields/CustomFieldsPanel.tsx');
    expect(offenders).toEqual([]);
  });
  it('mọi mục allow-list còn thật sự dùng disabled:opacity- (không để mục chết)', () => {
    for (const p of Object.keys(ALLOW)) expect(src(p), p).toMatch(/disabled:opacity-/);
  });
});
