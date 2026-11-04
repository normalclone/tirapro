import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_ROUTES } from '@/lib/legacyRoutes';
import { APP_NAV_LABELS, MANAGE_LABELS, SETTINGS_LABELS } from '@/lib/navLabels';

const root = join(__dirname, '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Mục tiêu / Rủi ro → tab dự án; Thời gian xử lý → Cấu hình dự án; Nhân lực → tab Thành viên. */
describe('bỏ "Danh mục": Mục tiêu, Rủi ro, Thời gian xử lý, Nhân lực về đúng chỗ', () => {
  const router = src('app/router.tsx');

  it('router dựng mọi liên kết cũ từ bảng LEGACY_ROUTES (một nguồn) + /manage/* lạ về Dự án', () => {
    expect(router).toMatch(/\.\.\.LEGACY_ROUTES\.map\(\(r\) => \(\{\s*path: r\.from,/);
    expect(router).toMatch(/<MovedRedirect to=\{r\.to\} message=\{r\.message\} \/>/);
    expect(router).toMatch(/path: 'manage\/\*', element: <Navigate to="\/projects" replace \/>/);
  });

  it('bảng chuyển hướng: đúng đích theo spec, không vòng lặp, không trùng', () => {
    const to = (from: string) => LEGACY_ROUTES.find((r) => r.from === from)?.to;
    expect(to('manage')).toBe('/projects?view=groups');
    expect(to('manage/portfolio')).toBe('/projects?view=groups');
    expect(to('portfolio')).toBe('/projects?view=groups');
    for (const f of [
      'manage/goals',
      'manage/risks',
      'manage/response-time',
      'goals',
      'raid',
      'sla',
    ])
      expect(to(f), f).toBe('/projects');
    expect(to('settings/response-time')).toBe('/projects');
    for (const f of ['manage/resources', 'resources'])
      expect(to(f), f).toBe('/members?tab=resources');
    for (const f of ['manage/clients', 'clients']) expect(to(f), f).toBe('/projects');
    expect(new Set(LEGACY_ROUTES.map((r) => r.from)).size).toBe(LEGACY_ROUTES.length);
    // Không vòng lặp: đích không phải một đường dẫn cũ (kể cả tiền tố /manage).
    const legacy = new Set(LEGACY_ROUTES.map((r) => '/' + r.from));
    for (const r of LEGACY_ROUTES) {
      const dest = r.to.split('?')[0]!;
      expect(legacy.has(dest), `${r.from} → ${r.to}`).toBe(false);
      expect(dest.startsWith('/manage'), `${r.from} → ${r.to}`).toBe(false);
    }
  });

  it('thông báo "đã chuyển" chỉ cho mục đã đổi chỗ, nêu đúng chỗ mới', () => {
    const msg = (from: string) => LEGACY_ROUTES.find((r) => r.from === from)?.message ?? '';
    expect(msg('manage/goals')).toMatch(/Mục tiêu giờ nằm trong từng dự án/);
    expect(msg('manage/risks')).toMatch(/từng dự án/);
    expect(msg('manage/response-time')).toMatch(/Cấu hình của từng dự án/);
    expect(msg('manage/resources')).toMatch(/Thành viên/);
    expect(msg('manage/portfolio')).toMatch(/Theo nhóm/);
    // Không dùng từ cấm trong chữ mới.
    for (const r of LEGACY_ROUTES)
      expect(r.message ?? '', r.from).not.toMatch(/workspace|không gian/i);
  });

  it('router không còn dựng các trang cũ', () => {
    expect(router).not.toMatch(
      /SlaBoardPage|SlaPoliciesPage|ResourcesPage|ManageLayout|PortfolioPage|ClientsPage/,
    );
  });

  it('thanh con của Cài đặt không còn mục đã chuyển', () => {
    expect(src('features/settings/SettingsLayout.tsx')).not.toContain('/settings/response-time');
    expect(Object.keys(SETTINGS_LABELS)).not.toContain('responseTime');
    expect(Object.keys(MANAGE_LABELS)).not.toContain('responseTime');
    expect(Object.keys(APP_NAV_LABELS)).not.toContain('manage');
  });

  it('không nơi nào trong web còn trỏ tới đường dẫn cũ /manage/{goals,risks,resources,response-time}', () => {
    const files = [
      'features/dashboard/LeadershipCards.tsx',
      'features/dashboards/widgets/TopRisksWidget.tsx',
      'features/dashboards/widgets/SlowGoalsWidget.tsx',
      'features/dashboards/widgets/OverloadWidget.tsx',
      'features/command/projectCommands.ts',
      'features/projects/ProjectLayout.tsx',
    ];
    for (const f of files)
      expect(src(f), f).not.toMatch(/\/manage\/(goals|risks|resources|response-time)/);
  });

  it('dashboard: dòng rủi ro/OKR dẫn tới tab của dự án đó; người quá tải dẫn tới tab Nhân lực', () => {
    const cards = src('features/dashboard/LeadershipCards.tsx');
    expect(cards).toMatch(/`\/p\/\$\{r\.project\.key\}\/risks`/);
    expect(cards).toMatch(/`\/p\/\$\{g\.project\.key\}\/goals`/);
    expect(cards).toContain('/members?tab=resources');
  });
});

describe('đã gỡ sạch: mục Danh mục, Khách hàng, trang Danh mục dự án cũ', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
    }
    return out;
  };
  const files = walk(root);

  it('thanh bên không có mục /manage; không còn nhãn "Danh mục" làm tên mục', () => {
    expect(src('components/layout/navItems.tsx')).not.toMatch(/\/manage|APP_NAV_LABELS\.manage/);
    expect(src('lib/routeSuggest.ts')).not.toMatch(/\/manage/);
    expect(src('features/assistant/screens.ts')).not.toMatch(/manage/);
  });

  it('mã nguồn không còn tham chiếu /manage ngoài bảng chuyển hướng', () => {
    const hits = files
      .filter((f) => !f.endsWith(join('lib', 'legacyRoutes.ts')))
      .filter((f) => /['"`]\/manage\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1));
    expect(hits).toEqual([]);
  });

  it('không còn module khách hàng / trang Danh mục dự án cũ / ManageLayout', () => {
    for (const rel of [
      'features/clients',
      'features/portfolio',
      'features/manage/ManageLayout.tsx',
    ])
      expect(existsSync(join(root, rel)), rel).toBe(false);
    const refs = files
      .filter((f) =>
        /features\/(clients|portfolio)\b|ClientsPage|PortfolioPage|ManageLayout/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => f.slice(root.length + 1));
    expect(refs).toEqual([]);
    expect(Object.keys(MANAGE_LABELS)).toEqual(['goals', 'risks', 'resources']);
  });

  it('chữ hướng dẫn / trợ lý không còn nhắc "Khách hàng & hợp đồng" hay mục "Danh mục"', () => {
    const doc = src('features/docs/DocumentationPage.tsx');
    expect(doc).not.toMatch(/Khách hàng & hợp đồng|mục\s+Danh mục của thanh/);
    expect(src('features/docs/docsIndex.ts')).not.toMatch(/khach hang|khách hàng/);
    expect(src('features/assistant/screens.ts')).not.toMatch(/khách hàng/i);
  });

  it('ProgramEditorModal và API nhóm nằm trong features/projects/groups', () => {
    for (const f of ['ProgramEditorModal.tsx', 'programsApi.ts'])
      expect(existsSync(join(root, 'features/projects/groups', f)), f).toBe(true);
  });
});
