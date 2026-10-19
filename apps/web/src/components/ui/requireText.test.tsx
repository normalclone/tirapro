import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RequireTextField } from './RequireText';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const fake = (value: string) => ({
  required: true,
  value,
  matches: false,
  reset: () => undefined,
  bind: {
    value,
    onChange: () => undefined,
    onCompositionStart: () => undefined,
    onCompositionEnd: () => undefined,
  },
});

describe('RequireTextField', () => {
  const html = renderToStaticMarkup(
    <RequireTextField expected="CI deploy" text={fake('')} onEnter={() => undefined} />,
  );
  it('nêu rõ chữ cần gõ trong nhãn gắn với ô nhập', () => {
    expect(html).toMatch(/<label[^>]*for="([^"]+)"/);
    expect(html).toContain('CI deploy');
    expect(html).toContain('để xác nhận');
  });
  it('ô nhập tắt gợi ý tự động và kiểm chính tả, không tự phóng to trên iOS (dùng Input chung)', () => {
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('spellcheck="false"');
  });
});

describe('008/269 · useConfirm + ConfirmDialog có requireText', () => {
  it('ConfirmOptions có requireText; nút xác nhận bị khoá tới khi khớp; focus vào ô nhập', () => {
    const s = read('components/ui/useConfirm.tsx');
    expect(s).toMatch(/requireText\?: string/);
    expect(s).toContain('RequireTextField');
    expect(s).toMatch(/disabled=\{!text\.matches\}/);
    expect(s).toContain('autoFocus={destructive && !needsText}');
  });
  it('ConfirmDialog (điều khiển bằng state) cũng có requireText và khoá nút', () => {
    const s = read('features/issues/ConfirmDialog.tsx');
    expect(s).toMatch(/requireText\?: string/);
    expect(s).toMatch(/disabled=\{!text\.matches\}/);
  });
  it('Cmd/Ctrl+Enter chỉ xác nhận khi đã khớp', () => {
    expect(read('components/ui/useConfirm.tsx')).toMatch(/onSubmit=\{[^}]*text\.matches/);
  });
});

describe('269 · nơi áp dụng (xoá cứng / thu hồi) đều bắt gõ tên', () => {
  const SITES: [string, number][] = [
    ['features/api-keys/ApiKeysPage.tsx', 1],
    ['features/workflow-settings/WorkflowSettingsPage.tsx', 3],
    ['features/settings-admin/CustomFieldsAdminSection.tsx', 1],
    ['features/settings/RolesPage.tsx', 1],
    ['features/goals/GoalsPage.tsx', 1],
    ['features/dashboards/DashboardViewPage.tsx', 1],
    ['features/clients/ClientsPage.tsx', 1],
    ['features/automation/RulesPage.tsx', 1],
    ['features/sla/SlaPage.tsx', 1],
    ['features/integrations/RepositorySection.tsx', 1],
    ['features/integrations/TelegramSection.tsx', 2],
    ['features/backlog/SprintEditDialog.tsx', 1],
  ];
  for (const [f, n] of SITES) {
    it(`${f} có ${n} chỗ requireText`, () => {
      expect(read(f).match(/requireText[:=]/g)?.length ?? 0).toBe(n);
    });
  }
  it('xoá mềm có Hoàn tác (bình luận, worklog…) KHÔNG bị bắt gõ', () => {
    for (const f of [
      'features/issue-edit/CommentsSection.tsx',
      'features/issues/WorklogPanel.tsx',
      'features/issues/IssueDetailPage.tsx',
      'features/project-config/GeneralSection.tsx',
    ])
      expect(read(f), f).not.toMatch(/requireText/);
  });
});
