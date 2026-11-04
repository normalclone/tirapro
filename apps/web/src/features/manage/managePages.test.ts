import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Route còn lại của Danh mục → file trang. Tất cả `xl` (B-D1). Mục tiêu/Rủi ro là tab dự án, SLA là mục Cấu hình, Nhân lực là tab Thành viên. */
const PAGES: [route: string, file: string][] = [
  ['portfolio', 'features/portfolio/PortfolioPage.tsx'],
  ['clients', 'features/clients/ClientsPage.tsx'],
];

/** Tab trong dự án (`/p/:key/goals|risks`): khung `full` bọc trong vùng cuộn như mọi tab dự án, tiêu đề h2. */
const PROJECT_TABS: [route: string, file: string][] = [
  ['goals', 'features/goals/GoalsPage.tsx'],
  ['risks', 'features/raid/RaidPage.tsx'],
];

describe('Mục tiêu / Rủi ro là tab của dự án', () => {
  it.each(PROJECT_TABS)(
    '%s: PageFrame full trong vùng cuộn, PageHeader variant="tab", không h1',
    (_r, file) => {
      const s = src(file);
      expect(s).toMatch(/<div className="h-full overflow-y-auto">\s*<PageFrame size="full">/);
      expect(s).toMatch(/<PageHeader\s+variant="tab"/);
      expect(s).not.toMatch(/<h1\b|pageContainer|<PageFrame size="xl">/);
    },
  );
  it('nút tạo chính nằm trong PageHeader.actions, cỡ sm', () => {
    for (const [file, label] of [
      ['features/goals/GoalsPage.tsx', 'Tạo mục tiêu'],
      ['features/raid/RaidPage.tsx', 'Thêm {kindMeta'],
    ] as const) {
      const s = src(file);
      const start = s.indexOf('<PageHeader');
      const actions = s.slice(start, s.indexOf('\n        }\n      />', start));
      expect(actions, file).toContain(label);
      expect(actions, file).toMatch(/<Button size="sm"/);
    }
  });
  it('dự án cố định: không còn bộ lọc dự án, tạo mới gắn dự án hiện tại', () => {
    for (const [, file] of PROJECT_TABS) {
      const s = src(file);
      expect(s, file).not.toMatch(/Lọc theo dự án|Mọi dự án|useScopeParam/);
      expect(s, file).toMatch(/project=\{project\}/);
    }
    for (const f of ['features/goals/GoalEditorModal.tsx', 'features/raid/RaidEditorModal.tsx']) {
      const s = src(f);
      expect(s, f).toMatch(/projectId: project\.id/);
      expect(s, f).not.toMatch(/Toàn tổ chức|setProjectId/);
    }
  });
});

describe('trang Danh mục dùng PageFrame xl + PageHeader (T5)', () => {
  it.each(PAGES)(
    '%s: PageFrame xl, PageHeader, không h1 tay, không pageContainer/max-w',
    (_r, file) => {
      const s = src(file);
      expect(s).toMatch(/<PageFrame size="xl">/);
      expect(s).toMatch(/<PageHeader\b/);
      expect(s).not.toMatch(/<h1\b/);
      expect(s).not.toMatch(/pageContainer/);
      expect(s).not.toMatch(/\bmax-w-(3xl|4xl|5xl|7xl)\b/);
    },
  );
  it('trang trong SubNavLayout không tự truyền back', () => {
    for (const [, file] of PAGES) expect(src(file), file).not.toMatch(/\bback=\{/);
  });
  it('nút tạo chính nằm trong PageHeader.actions, cùng cỡ sm', () => {
    for (const [file, label] of [
      ['features/portfolio/PortfolioPage.tsx', 'Tạo chương trình'],
      ['features/clients/ClientsPage.tsx', 'Thêm khách hàng'],
    ] as const) {
      const s = src(file);
      const start = s.indexOf('<PageHeader');
      const actions = s.slice(start, s.indexOf('\n      />', start));
      expect(actions, file).toContain(label);
      expect(actions, file).toMatch(/<Button size="sm"/);
    }
  });
  it('Nhân lực: tab của Thành viên, Tải CSV chỉ ở tab khối lượng (cuối hàng bộ lọc)', () => {
    const r = src('features/resources/ResourcesPage.tsx');
    expect(r).toMatch(/tab === 'load' && \(\s*<div className="ml-auto">\s*<WorkloadExport/);
    expect(r).not.toMatch(/<PageFrame|<PageHeader/);
    expect(src('features/members/MembersPage.tsx')).toMatch(/<ResourcesPanel \/>/);
  });
  it('nút tạo trong EmptyState là secondary (B-D6)', () => {
    for (const f of [
      'features/portfolio/PortfolioPage.tsx',
      'features/goals/GoalsPage.tsx',
      'features/raid/RaidPage.tsx',
      'features/clients/ClientsPage.tsx',
      'features/resources/TimeOffPanel.tsx',
      'features/resources/AllocationsPanel.tsx',
    ]) {
      const s = src(f);
      const empties = [...s.matchAll(/action=\{[\s\S]{0,160}?<Button([^>]*)>/g)].map(
        (m) => m[1] ?? '',
      );
      expect(empties.length, f).toBeGreaterThan(0);
      for (const attrs of empties) expect(attrs, f).toMatch(/variant="secondary"/);
    }
  });
  it('thẻ có nút/số đếm ở header dùng SectionCard (RB2): Nghỉ phép, Phân bổ, Danh sách rủi ro, Đang chạy đồng hồ', () => {
    for (const [f, title] of [
      ['features/resources/TimeOffPanel.tsx', 'Nghỉ phép & ngày lễ'],
      ['features/resources/AllocationsPanel.tsx', 'Phân bổ người vào dự án'],
      ['features/raid/RaidPage.tsx', 'Danh sách chi tiết'],
      ['features/sla/SlaPage.tsx', 'Đang chạy đồng hồ'],
    ] as const) {
      const s = src(f);
      expect(s, f).toMatch(new RegExp(`<SectionCard[\\s\\S]{0,80}title="${title}"`));
      expect(s, f).toContain("from '@/components/ui/SectionCard'");
    }
    expect(src('features/resources/TimeOffPanel.tsx')).not.toMatch(
      /<section className="rounded-lg/,
    );
    expect(src('features/resources/AllocationsPanel.tsx')).not.toMatch(
      /<section className="rounded-lg/,
    );
  });
});
