import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldBlockNavigation } from '@/lib/unsavedChanges';

const root = join(__dirname, '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');
/** Mã không kể chú thích (để cấm tên hook mà chú thích vẫn được nhắc tới). */
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('Tích hợp là route con (T6)', () => {
  const router = src('app/router.tsx');
  it('/connect/integrations có index (redirect, nhận cả ?section= cũ) và /:section, dưới RequireAccess', () => {
    expect(router).toMatch(
      /path: 'integrations',\s*element: <IntegrationsPage \/>,\s*children: \[/,
    );
    expect(router).toMatch(/index: true, element: <IntegrationsIndexRedirect \/>/);
    expect(router).toMatch(/path: ':section', element: <IntegrationSection \/>/);
    expect(router.indexOf('RequireAccess rule={NAV_RULES.connectIntegrations}')).toBeLessThan(
      router.indexOf("path: 'integrations',"),
    );
  });
  it('trang không còn state chuyển mục, guard thủ công, rail tầng 3 hay container tự đặt', () => {
    const s = code('features/integrations/IntegrationsPage.tsx');
    expect(s).not.toMatch(
      /useConfirmDiscard|useState|useSearchParams|<h1|scroll-fade-x|pageContainer/,
    );
    expect(s).toMatch(/<PageFrame size="sm">/);
    expect(s).toMatch(/<PageHeader title=\{CONNECT_LABELS\.integrations\}/);
    expect(s).toMatch(/<LinkTabs/);
    expect(s).toMatch(/<Outlet \/>/);
  });
  it('liên kết Tổng quan trỏ thẳng route mới; kịch bản mobile-audit vẫn dùng ?section= (kiểm redirect)', () => {
    expect(src('features/dashboard/DashboardPage.tsx')).toContain(
      'to="/connect/integrations/digest"',
    );
    expect(src('features/dashboard/DashboardPage.tsx')).not.toContain('?section=digest');
  });
  it('đổi mục đổi pathname → guard rời trang bắt được (khác state cũ phải gọi confirmDiscard)', () => {
    expect(
      shouldBlockNavigation({
        currentLocation: { pathname: '/connect/integrations/telegram' },
        nextLocation: { pathname: '/connect/integrations/digest' },
      }),
    ).toBe(true);
  });
});

describe('Kết nối: Tự động hoá + Quy tắc dùng khung chung', () => {
  it('Tự động hoá: PageFrame sm + PageHeader, không h1/pageContainer tay', () => {
    const s = src('features/automation/AutomationPage.tsx');
    expect(s).toMatch(/<PageFrame size="sm">/);
    expect(s).toMatch(/<PageHeader\b/);
    expect(s).not.toMatch(/<h1|pageContainer|max-w-/);
  });
  it('3 thẻ (Quy tắc, Mẫu, Lặp lại) là SectionCard, nút tạo ở actions, EmptyState secondary', () => {
    for (const [f, title, btn] of [
      ['features/automation/RulesPage.tsx', 'Quy tắc tự động', 'Tạo quy tắc'],
      ['features/automation/AutomationPage.tsx', 'Mẫu công việc', 'Tạo mẫu'],
      ['features/automation/AutomationPage.tsx', 'Công việc lặp lại', 'Tạo lịch lặp'],
    ] as const) {
      const s = src(f);
      expect(s, f).toMatch(new RegExp(`<SectionCard\\s+title="${title}"`));
      const at = s.indexOf(`title="${title}"`);
      expect(s.slice(at, at + 900), f).toContain(btn);
      expect(s, f).toMatch(
        new RegExp(
          `variant="secondary" size="sm" onClick=\\{\\(\\) => (open|edit)\\(null\\)\\}>\\s*<Plus className="h-4 w-4" /> ${btn}`,
        ),
      );
    }
    for (const f of ['features/automation/RulesPage.tsx', 'features/automation/AutomationPage.tsx'])
      expect(src(f), f).not.toMatch(/<section className="rounded-lg/);
  });
  it('ô phạm vi quy tắc chiếm cả hàng dưới sm để nút "Tạo quy tắc" không tràn thẻ ở 390px', () => {
    expect(src('features/automation/RulesPage.tsx')).toMatch(/className="w-52 max-sm:w-full"/);
  });
  it('trang trong SubNavLayout không tự truyền back', () => {
    for (const f of [
      'features/integrations/IntegrationsPage.tsx',
      'features/automation/AutomationPage.tsx',
    ])
      expect(src(f), f).not.toMatch(/\bback=\{/);
  });
});
