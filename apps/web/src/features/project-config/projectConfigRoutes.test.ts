import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_SECTION_IDS,
  configRedirectTarget,
  configSectionPath,
  isConfigSection,
} from './configSections';

const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
/** Bỏ chú thích để regex không khớp nhầm lời giải thích. */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('Cấu hình dự án là route con', () => {
  it('đường dẫn mục', () => {
    expect(configSectionPath('ABC', 'labels')).toBe('/p/ABC/config/labels');
    expect(CONFIG_SECTION_IDS).toHaveLength(6);
  });
  it('isConfigSection nhận đúng id, từ chối giá trị lạ/rỗng', () => {
    expect(isConfigSection('data')).toBe(true);
    expect(isConfigSection('nope')).toBe(false);
    expect(isConfigSection(null)).toBe(false);
    expect(isConfigSection(undefined)).toBe(false);
  });
  it('?section= cũ chuyển sang route con, giữ tham số khác', () => {
    expect(configRedirectTarget('ABC', '?section=members')).toBe('/p/ABC/config/members');
    expect(configRedirectTarget('ABC', '?section=versions&x=1')).toBe('/p/ABC/config/versions?x=1');
  });
  it('không có / sai section → Chung', () => {
    expect(configRedirectTarget('ABC', '')).toBe('/p/ABC/config/general');
    expect(configRedirectTarget('ABC', '?section=zzz')).toBe('/p/ABC/config/general');
  });
  it('router: config có index (chuyển hướng) và :section', () => {
    const r = src('app/router.tsx');
    expect(r).toMatch(/path: 'config'[\s\S]{0,200}index: true, element: <ConfigIndexRedirect/);
    expect(r).toMatch(/path: ':section', element: <ConfigSection/);
  });
  it('trang dùng SubNavLayout (route), không h1, không useConfirmDiscard/pageContainer', () => {
    const s = code('features/project-config/ProjectConfigPage.tsx');
    expect(s).toMatch(/<SubNavLayout[\s\S]*?basePath=\{`\/p\/\$\{key\}\/config`\}/);
    expect(s).toMatch(/variant="tab"/);
    expect(s).not.toMatch(/<h1|useConfirmDiscard|pageContainer|uppercase/);
  });
  it('mục đơn thẻ không tự vẽ tiêu đề thẻ; General/Avatar/Privacy dùng h3', () => {
    for (const f of ['Components', 'Versions', 'Labels', 'Data', 'Members']) {
      expect(code(`features/project-config/${f}Section.tsx`), f).not.toMatch(
        /<SectionCard[^>]*\btitle=/,
      );
    }
    for (const f of ['GeneralSection', 'PrivacySection', 'ProjectConfigPage']) {
      expect(code(`features/project-config/${f}.tsx`), f).toMatch(/headingLevel=\{3\}/);
    }
  });
});

describe('h1 của dự án', () => {
  it('dưới lg h1 tên dự án chỉ ẩn bằng sr-only (không hidden) để trang luôn có đúng một h1', () => {
    const s = code('features/projects/ProjectLayout.tsx');
    expect(s).toMatch(/<h1[\s\S]{0,200}max-lg:sr-only/);
    expect(s).not.toMatch(/<h1[\s\S]{0,200}hidden lg:block/);
  });
});

describe('tab dự án full-bleed', () => {
  const TABS = [
    'features/triage/TriagePage.tsx',
    'features/trash/TrashPage.tsx',
    'features/intake/ProjectActivityPage.tsx',
    'features/tree/TreePage.tsx',
    'features/reports/ReportsPage.tsx',
  ];
  it('dùng PageFrame full, không pageContainer, không h1', () => {
    for (const f of TABS) {
      const s = code(f);
      expect(s, f).toMatch(/<PageFrame size="full"/);
      expect(s, f).not.toMatch(/pageContainer|<h1/);
    }
  });
  it('tab có tiêu đề riêng dùng PageHeader variant="tab" (h2)', () => {
    for (const f of TABS.filter((t) => !t.includes('TreePage')))
      expect(code(f), f).toMatch(/<PageHeader[\s\S]{0,40}variant="tab"/);
  });
  it('tab có FAB giữ đệm đáy lg:pb-24 ngay trên khung', () => {
    for (const f of ['features/triage/TriagePage.tsx', 'features/tree/TreePage.tsx'])
      expect(code(f), f).toMatch(/<PageFrame size="full" className="lg:pb-24"/);
  });
});
