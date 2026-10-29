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
  justComposedRef: { current: false },
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
  it('nhãn gắn đúng với ô nhập: htmlFor của nhãn = id của ô', () => {
    const forId = /<label[^>]*for="([^"]+)"/.exec(html)?.[1];
    const inputId = /<input[^>]*\sid="([^"]+)"/.exec(html)?.[1];
    expect(forId).toBeTruthy();
    expect(inputId).toBe(forId);
  });
  it('nêu rõ chữ cần gõ trong nhãn', () => {
    expect(html).toContain('CI deploy');
    expect(html).toContain('để xác nhận');
  });
  it('ô nhập tắt gợi ý tự động và kiểm chính tả, không tự phóng to trên iOS (dùng Input chung)', () => {
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('spellcheck="false"');
  });
});

describe('269 · useConfirm có requireText', () => {
  it('ConfirmOptions có requireText; nút xác nhận bị khoá tới khi khớp; focus vào ô nhập', () => {
    const s = read('components/ui/useConfirm.tsx');
    expect(s).toMatch(/requireText\?: string/);
    expect(s).toContain('RequireTextField');
    expect(s).toMatch(/disabled=\{!text\.matches\}/);
    expect(s).toContain('autoFocus={destructive && !needsText}');
  });
  it('ConfirmDialog (bản state) KHÔNG có requireText — không còn nơi dùng (RC4)', () => {
    const s = read('features/issues/ConfirmDialog.tsx');
    expect(s).not.toMatch(/requireText|RequireText|lastRequireText/);
  });
  it('Cmd/Ctrl+Enter: chỉ đặt onSubmit khi có ô gõ (xác nhận thường giữ hành vi cũ), và chỉ xác nhận khi khớp', () => {
    expect(read('components/ui/useConfirm.tsx')).toMatch(/onSubmit=\{\s*needsText\b/);
  });
  it('ô gõ dùng shouldSubmitOnEnter (Safari IME) và theo dõi compositionend', () => {
    const s = read('components/ui/RequireText.tsx');
    expect(s).toContain('shouldSubmitOnEnter(');
    expect(s).toContain('justComposedRef');
  });
  it('chữ đã gõ gắn với lần mở (không reset bằng effect → mở lại không lộ chữ cũ dù một commit)', () => {
    expect(read('components/ui/useConfirm.tsx')).not.toMatch(/reset\(\)/);
    expect(read('components/ui/useConfirm.tsx')).not.toMatch(/useEffect/);
  });
  it('hẹn giờ justComposed được xoá khi gỡ khỏi cây (unmount)', () => {
    const s = read('components/ui/RequireText.tsx');
    expect(s).toMatch(/useEffect\(\(\) => \(\) => window\.clearTimeout\(timer\.current\)/);
  });
});

describe('269 · chỉ 4 nơi bắt gõ tên (RC2)', () => {
  const SITES: [string, number][] = [
    ['features/api-keys/ApiKeysPage.tsx', 1],
    ['features/workflow-settings/WorkflowSettingsPage.tsx', 1],
    ['features/settings-admin/CustomFieldsAdminSection.tsx', 1],
    ['features/settings/RolesPage.tsx', 1],
  ];
  for (const [f, n] of SITES) {
    it(`${f} có ${n} chỗ requireText`, () => {
      expect(read(f).match(/requireText[:=]/g)?.length ?? 0).toBe(n);
    });
  }
  it('quy trình: chỉ xoá quy trình bắt gõ, trạng thái/bước chuyển thì không', () => {
    const s = read('features/workflow-settings/WorkflowSettingsPage.tsx');
    const at = s.indexOf('requireText: wf.name');
    expect(at).toBeGreaterThan(0);
    expect(s).not.toMatch(/requireText: (status|t)\.name/);
  });
  const NOT: string[] = [
    'features/goals/GoalsPage.tsx',
    'features/dashboards/DashboardViewPage.tsx',
    'features/clients/ClientsPage.tsx',
    'features/automation/RulesPage.tsx',
    'features/sla/SlaPage.tsx',
    'features/integrations/RepositorySection.tsx',
    'features/integrations/TelegramSection.tsx',
    'features/backlog/SprintEditDialog.tsx',
    'features/issue-edit/CommentsSection.tsx',
    'features/issues/WorklogPanel.tsx',
    'features/issues/IssueDetailPage.tsx',
    'features/project-config/GeneralSection.tsx',
  ];
  for (const f of NOT)
    it(`${f} KHÔNG bắt gõ tên`, () => {
      expect(read(f)).not.toMatch(/requireText/);
    });
});
