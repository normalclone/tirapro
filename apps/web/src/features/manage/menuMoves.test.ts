import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANAGE_LABELS, SETTINGS_LABELS } from '@/lib/navLabels';

const root = join(__dirname, '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Mục tiêu / Rủi ro → tab dự án; Thời gian xử lý → Cấu hình dự án; Nhân lực → tab Thành viên. */
describe('chuyển Mục tiêu, Rủi ro, Thời gian xử lý, Nhân lực ra khỏi Danh mục/Cài đặt', () => {
  const router = src('app/router.tsx');

  it('liên kết cũ không chết: chuyển hướng về chỗ mới', () => {
    for (const p of ['goals', 'risks', 'response-time'])
      expect(router).toMatch(
        new RegExp(`path: '${p}', element: <Navigate to="/projects" replace />`),
      );
    expect(router).toMatch(
      /path: 'resources', element: <Navigate to="\/members\?tab=resources" replace \/>/,
    );
    // Đường tắt cũ cấp cao nhất.
    expect(router).toMatch(/path: 'goals', element: <Navigate to="\/projects" replace \/>/);
    expect(router).toMatch(/path: 'raid', element: <Navigate to="\/projects" replace \/>/);
    expect(router).toMatch(/path: 'sla', element: <Navigate to="\/projects" replace \/>/);
    expect(router).toMatch(
      /path: 'resources', element: <Navigate to="\/members\?tab=resources" replace \/>/,
    );
  });

  it('router không còn dựng các trang cũ ở /manage hay /settings', () => {
    expect(router).not.toMatch(/SlaBoardPage|SlaPoliciesPage|ResourcesPage/);
    expect(router).not.toMatch(/<GoalsPage \/>[\s\S]*<GoalsPage \/>/); // chỉ một nơi: tab dự án
  });

  it('thanh con của Danh mục và Cài đặt không còn các mục đã chuyển', () => {
    const manage = src('features/manage/ManageLayout.tsx');
    for (const p of ['goals', 'risks', 'resources', 'response-time'])
      expect(manage).not.toContain(`/manage/${p}`);
    expect(src('features/settings/SettingsLayout.tsx')).not.toContain('/settings/response-time');
    expect(Object.keys(SETTINGS_LABELS)).not.toContain('responseTime');
    expect(Object.keys(MANAGE_LABELS)).not.toContain('responseTime');
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
