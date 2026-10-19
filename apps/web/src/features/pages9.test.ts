import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('Bộ lọc, Wiki, chi tiết công việc dùng khung chung (T9)', () => {
  it.each([
    ['Bộ lọc', 'features/saved-filters/FiltersPage.tsx'],
    ['Wiki', 'features/wiki/WikiPage.tsx'],
    ['Chi tiết công việc', 'features/issues/IssueDetailPage.tsx'],
  ])('%s: PageFrame lg + PageHeader, không pageContainer/max-w', (_n, file) => {
    const s = src(file);
    expect(s).toMatch(/<PageFrame size="lg"/);
    expect(s).toMatch(/<PageHeader\b/);
    expect(s).not.toMatch(/pageContainer/);
    expect(s).not.toMatch(/\bmax-w-(3xl|4xl|5xl|7xl)\b/);
  });
  it('Bộ lọc và Wiki dùng RailLayout (master–detail, không "bước vào")', () => {
    for (const f of ['features/saved-filters/FiltersPage.tsx', 'features/wiki/WikiPage.tsx']) {
      expect(src(f), f).toMatch(/<RailLayout\b/);
      expect(src(f), f).not.toMatch(/<h1\b|uppercase/);
    }
  });
  it('Bộ lọc: "Tạo bộ lọc" trong PageHeader.actions, không còn trong rail; hết icon cạnh tiêu đề', () => {
    const s = src('features/saved-filters/FiltersPage.tsx');
    const at = s.indexOf('<PageHeader');
    const header = s.slice(at, s.indexOf('/>', s.indexOf('actions={', at) + 400));
    expect(header).toContain('Tạo bộ lọc');
    expect(s.match(/Tạo bộ lọc\n/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(s).not.toMatch(/<h2[^>]*>\{heading\}/);
    expect(s).toMatch(/title=\{heading\}/);
  });
  it('Wiki: không còn card viền bao rail; breadcrumb ở PageHeader (breadcrumbMobile mặc định), không nav trong bài', () => {
    const s = src('features/wiki/WikiPage.tsx');
    expect(s).not.toMatch(/lg:sticky lg:top-4/);
    expect(s).not.toContain('aria-label="Đường dẫn trang"');
    expect(s).toMatch(/breadcrumb=\{crumbs\}/);
    expect(s).not.toMatch(/breadcrumbMobile=\{false\}/);
  });
  it('Wiki giữ pendingNew, WikiEditor, singleFlight và guard rời trang (phần A)', () => {
    const s = src('features/wiki/WikiPage.tsx');
    expect(s).toContain('pendingNew');
    expect(s).toContain('<WikiEditor');
    expect(s).toMatch(/singleFlight/);
    expect(s).toContain('useWikiDraft(');
    expect(src('features/wiki/useWikiDraft.ts')).toMatch(/useLeaveGuard|useUnsavedChanges/);
  });
  it('Chi tiết công việc: h1 là tiêu đề ẩn của PageHeader; ô tiêu đề hiển thị không còn là h1; sửa tại chỗ giữ nguyên', () => {
    const s = src('features/issues/IssueDetailPage.tsx');
    expect(s).toMatch(/<PageHeader\s+titleHidden/);
    expect(s).not.toMatch(/<h1\b/);
    expect(s).toContain('setEditingSummary(true)');
    expect(s).toContain("e.key === 'Escape'");
    expect(s).not.toMatch(/breadcrumbMobile=\{false\}/);
    expect(s).not.toContain('aria-label="Breadcrumb"');
  });
  it('Chi tiết công việc: breadcrumb dùng mono/title; nút sao chép mã nằm trong actions', () => {
    const s = src('features/issues/IssueDetailPage.tsx');
    expect(s).toMatch(
      /mono: true,\s*title: `\$\{parent\.isEpic \? 'Epic' : 'Việc cha'\}: \$\{parent\.summary\}`/,
    );
    const at = s.indexOf('<PageHeader');
    const actions = s.slice(
      s.indexOf('actions={', at),
      s.indexOf('/>', s.indexOf('Sao chép mã công việc', at)),
    );
    expect(actions).toContain('onClick={copyKey}');
  });
  it('trang "không tìm thấy" công việc hạ tiêu đề xuống h2 (h1 là của PageHeader)', () => {
    expect(src('features/issues/IssueNotFound.tsx')).toMatch(/headingLevel=\{2\}/);
  });
});
