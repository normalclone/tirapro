import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_FRAME_WIDTH, pageFrameClass } from './PageFrame';

const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const ROOT = join(__dirname, '..', '..');
const all = walk(ROOT).map((p) => ({
  rel: p.slice(ROOT.length + 1),
  text: readFileSync(p, 'utf8'),
}));
/** Bỏ chú thích để regex cấm không khớp nhầm lời giải thích. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const maxW = (s: string) => s.match(/max-w-[\w[\].-]+/g) ?? [];

describe('PageFrame — bảng cỡ (B-D1)', () => {
  it('đúng bốn cỡ sm|lg|xl|full', () => {
    expect(Object.keys(PAGE_FRAME_WIDTH)).toEqual(['sm', 'lg', 'xl', 'full']);
  });
  it.each([
    ['sm', 'max-w-3xl'],
    ['lg', 'max-w-5xl'],
    ['xl', 'max-w-7xl'],
  ] as const)('%s → %s', (size, cls) => {
    expect(pageFrameClass(size)).toContain(cls);
  });
  it('full không giới hạn bề rộng', () => {
    expect(maxW(pageFrameClass('full'))).toEqual([]);
  });
  it('đệm: ngang 16 → 24px, dọc 24 → 32px, đáy chừa FAB từ lg', () => {
    for (const size of ['sm', 'lg', 'xl', 'full'] as const) {
      const c = pageFrameClass(size);
      for (const t of [
        'mx-auto',
        'w-full',
        'px-4',
        'sm:px-6',
        'pt-6',
        'sm:pt-8',
        'pb-8',
        'lg:pb-28',
      ])
        expect(c.split(' ')).toContain(t);
    }
  });
  it('className của trang ghi đè đệm (vd py-6 của Tổng quan)', () => {
    const c = pageFrameClass('xl', 'py-6').split(' ');
    expect(c).toContain('py-6');
    expect(c).not.toContain('pt-6');
    expect(c).not.toContain('pb-8');
  });
});

describe('không max-w ngoài bảng cỡ khung', () => {
  it('PageFrame.tsx: mọi max-w nằm trong bảng PAGE_FRAME_WIDTH', () => {
    const table = Object.values(PAGE_FRAME_WIDTH).filter(Boolean);
    for (const m of maxW(src('components/layout/PageFrame.tsx'))) expect(table).toContain(m);
  });
  it('pageContainer (RB1) đã xoá: không còn file page.ts, không nơi nào gọi', () => {
    expect(existsSync(join(__dirname, 'page.ts'))).toBe(false);
    expect(all.filter((f) => /\bpageContainer\b/.test(code(f.text))).map((f) => f.rel)).toEqual([]);
  });
  it('PageHeader.tsx không tự đặt max-w', () => {
    expect(maxW(src('components/layout/PageHeader.tsx'))).toEqual([]);
  });
});

describe('chặn tái phạm khung trang (đợt 2 · phần B)', () => {
  // Chỗ DUY NHẤT được đặt max-w-3xl…7xl ngoài PageFrame — mỗi dòng kèm lý do.
  const MAXW_ALLOW: Record<string, string> = {
    'components/ui/Dialog.tsx': 'cỡ hộp thoại xl (bảng cỡ của Dialog, không phải khung trang)',
    'features/docs/DocumentationPage.tsx':
      'bài viết tài liệu công khai, độc lập (không trong AppShell)',
  };
  it('không max-w-(3xl|4xl|5xl|6xl|7xl) ngoài PageFrame, trừ danh sách cho phép có lý do', () => {
    const bad = all
      .filter((f) => f.rel !== 'components/layout/PageFrame.tsx')
      .filter((f) => /\bmax-w-(3xl|4xl|5xl|6xl|7xl)\b/.test(code(f.text)))
      .map((f) => f.rel)
      .filter((r) => !(r in MAXW_ALLOW));
    expect(bad).toEqual([]);
  });
  it('danh sách cho phép không có mục thừa (file còn dùng max-w đó)', () => {
    for (const rel of Object.keys(MAXW_ALLOW))
      expect(code(all.find((f) => f.rel === rel)?.text ?? ''), rel).toMatch(
        /\bmax-w-(3xl|4xl|5xl|6xl|7xl)\b/,
      );
  });

  it('menu con không uppercase (SubNavLayout + subNavModel + các layout mỏng)', () => {
    for (const f of [
      'components/layout/SubNavLayout.tsx',
      'components/layout/subNavModel.ts',
      'components/layout/RailLayout.tsx',
      'features/settings/SettingsLayout.tsx',
      'features/manage/ManageLayout.tsx',
      'features/connect/ConnectLayout.tsx',
      'features/project-config/ProjectConfigPage.tsx',
    ])
      expect(code(src(f)), f).not.toMatch(/\buppercase\b/);
  });

  it('mỗi file có tối đa một <h1 (hoặc dùng PageHeader, không tự vẽ h1 trùng)', () => {
    const bad: string[] = [];
    for (const f of all) {
      const t = code(f.text);
      const h1 = (t.match(/<h1\b/g) ?? []).length;
      if (h1 > 1) bad.push(`${f.rel}: ${h1} h1`);
      if (h1 >= 1 && /<PageHeader\b(?![^>]*variant="tab")/.test(t)) {
        // đã có PageHeader (h1) mà còn h1 tay → chỉ chi tiết công việc (PageHeader title-less) được phép
        if (f.rel !== 'features/issues/IssueDetailPage.tsx')
          bad.push(`${f.rel}: h1 tay + PageHeader`);
      }
    }
    expect(bad).toEqual([]);
  });

  // ---- thẻ cục bộ (RB2): SectionCard là thẻ duy nhất có tiêu đề + header viền.
  const CARD_ALLOW: Record<string, string> = {
    'features/reports/charts.tsx':
      'ô biểu đồ của tab Báo cáo: tiêu đề h3 + chú thích nằm TRONG thẻ, không icon/nút/chân thẻ (print-avoid-break)',
    'features/docs/DocumentationPage.tsx': 'ô thông số của trang tài liệu công khai, tĩnh',
    'features/automation/RuleEditor.tsx':
      'hàng lồng bên trong trình sửa quy tắc (điều kiện/hành động), không phải thẻ của trang',
    'features/board/Card.tsx': 'thẻ công việc trên Bảng việc (kéo-thả), không phải thẻ mục',
  };
  it('không khai báo function SectionCard/Card cục bộ, trừ danh sách cho phép có lý do', () => {
    const bad = all
      .filter((f) => f.rel !== 'components/ui/SectionCard.tsx')
      .filter((f) => /\bfunction (SectionCard|Card)\b/.test(code(f.text)))
      .map((f) => f.rel)
      .filter((r) => !(r in CARD_ALLOW));
    expect(bad).toEqual([]);
  });
  it('danh sách Card cho phép không có mục thừa', () => {
    for (const rel of Object.keys(CARD_ALLOW))
      expect(code(all.find((f) => f.rel === rel)?.text ?? ''), rel).toMatch(
        /\bfunction (SectionCard|Card)\b/,
      );
  });
  it('GroupCard, ClientCard, GoalCard được giữ vì là thẻ MỤC DANH SÁCH thu/mở (không phải thẻ khu vực)', () => {
    // Lý do (DESIGN.md "Khung trang"): mỗi thẻ là một thực thể lặp (chương trình/khách hàng/mục tiêu), tiêu đề
    // là nút thu/mở kèm tiến độ/trạng thái — SectionCard (tiêu đề tĩnh + icon) không biểu diễn được. Phải thu/mở.
    for (const [f, fn] of [
      ['features/portfolio/PortfolioPage.tsx', 'GroupCard'],
      ['features/clients/ClientsPage.tsx', 'ClientCard'],
      ['features/goals/GoalsPage.tsx', 'GoalCard'],
    ] as const) {
      const t = code(src(f));
      const start = t.indexOf(`function ${fn}(`);
      expect(start, `${f} ${fn}`).toBeGreaterThan(-1);
      expect(t.slice(start, start + 6000), `${f} ${fn}`).toMatch(/aria-expanded/);
    }
  });
  it('không tự vẽ header thẻ có viền dưới + tiêu đề (dùng SectionCard), trừ panel bên', () => {
    const HEADER_ALLOW: Record<string, string> = {
      'features/backlog/EpicPanel.tsx': 'panel bên của Backlog (cột Epic), không phải thẻ nội dung',
    };
    const re =
      /className=(?:"|\{?`|\{cn\()[^"`]*?\bborder-b border-border\b[^"`]*?\b(?:px|py)-[\d.]+[^"`]*?["`]\)?\}?>([\s\S]{0,400}?)(?=<\/div>)/g;
    const bad: string[] = [];
    for (const f of all) {
      if (f.rel === 'components/ui/SectionCard.tsx' || f.rel in HEADER_ALLOW) continue;
      for (const m of code(f.text).matchAll(re)) if (/<h[1-6]\b/.test(m[1] ?? '')) bad.push(f.rel);
    }
    expect(bad).toEqual([]);
  });

  it('nút tạo trong EmptyState là secondary ở các trang Kết nối/Tích hợp (B-D6)', () => {
    for (const f of [
      'features/integrations/RepositorySection.tsx',
      'features/integrations/TelegramSection.tsx',
      'features/digests/DigestsSection.tsx',
      'features/automation/AutomationPage.tsx',
      'features/automation/RulesPage.tsx',
    ]) {
      const empties = [...src(f).matchAll(/action=\{[\s\S]{0,160}?<Button([^>]*)>/g)].map(
        (m) => m[1] ?? '',
      );
      expect(empties.length, f).toBeGreaterThan(0);
      for (const attrs of empties) expect(attrs, f).toMatch(/variant="secondary"/);
    }
  });
});
