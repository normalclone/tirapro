import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** 6 route của Danh mục → file trang. Tất cả `xl` (B-D1). */
const PAGES: [route: string, file: string][] = [
  ['portfolio', 'features/portfolio/PortfolioPage.tsx'],
  ['goals', 'features/goals/GoalsPage.tsx'],
  ['risks', 'features/raid/RaidPage.tsx'],
  ['resources', 'features/resources/ResourcesPage.tsx'],
  ['response-time', 'features/sla/SlaPage.tsx'],
  ['clients', 'features/clients/ClientsPage.tsx'],
];

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
      ['features/goals/GoalsPage.tsx', 'Tạo mục tiêu'],
      ['features/raid/RaidPage.tsx', 'Thêm {kindMeta'],
      ['features/clients/ClientsPage.tsx', 'Thêm khách hàng'],
    ] as const) {
      const s = src(file);
      const start = s.indexOf('<PageHeader');
      const actions = s.slice(start, s.indexOf('\n      />', start));
      expect(actions, file).toContain(label);
      expect(actions, file).toMatch(/<Button size="sm"/);
    }
  });
  it('Nhân lực: xuất CSV trong PageHeader.actions (chỉ ở tab khối lượng)', () => {
    expect(src('features/resources/ResourcesPage.tsx')).toMatch(
      /<PageHeader[\s\S]*?actions=\{\s*showExport\s*\?\s*<WorkloadExport/,
    );
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
