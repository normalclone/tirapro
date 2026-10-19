import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('mobile nền chung', () => {
  it('ô nhập 16px dưới sm: quy tắc toàn cục phải có !important (utility .text-base/.text-sm thắng @layer base)', () => {
    expect(css).toMatch(
      /@media \(max-width: 639px\)\s*\{[^@]*?(input|textarea)[^}]*font-size:\s*16px\s*!important/,
    );
  });
  it('<Input> và ô tìm của SearchSelect tự đặt 16px dưới sm (class thật, không chỉ dựa CSS toàn cục)', () => {
    expect(src('components/ui/Input.tsx')).toMatch(/max-sm:text-\[16px\]/);
    expect(src('components/ui/SearchSelect.tsx')).toMatch(/max-sm:text-\[16px\]/);
  });
  it('16px là TỐI THIỂU: ô tiêu đề cỡ lớn (text-lg/xl…) không bị ép xuống 16px (CSS toàn cục + <Input>)', () => {
    const rule =
      /@media \(max-width: 639px\)\s*\{[^@]*?font-size:\s*16px\s*!important/.exec(css)?.[0] ?? '';
    for (const cls of ['text-lg', 'text-xl', 'text-2xl', 'text-3xl']) {
      expect(rule).toContain(`.${cls}`);
    }
    expect(src('components/ui/Input.tsx')).toMatch(/LARGE_TEXT/);
  });
  it('có lớp scroll-fade-x', () => expect(css).toMatch(/\.scroll-fade-x/));
  it('viewport-fit=cover', () => expect(html).toMatch(/viewport-fit=cover/));
  it('gợi ý phím (.kbd-hint) ẩn trên cảm ứng; KHÔNG có luật `kbd` trần toàn cục (kbd trong nội dung giữ nguyên)', () => {
    expect(css).toMatch(
      /@media \(hover: none\) and \(pointer: coarse\)\s*\{[^@]*?\.kbd-hint\s*\{[^}]*display:\s*none/,
    );
    // bỏ chú thích CSS rồi kiểm không có bộ chọn `kbd {` đứng riêng
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(bare).not.toMatch(/(^|[\s,{}])kbd\s*[,{]/);
  });
  it('kbd thuần gợi ý có .kbd-hint; kbd làm nội dung (Phím tắt, Hướng dẫn) thì không', () => {
    for (const f of [
      'components/layout/FloatingActions.tsx',
      'components/layout/AppShell.tsx',
      'features/command/CommandPalette.tsx',
      'features/issues/IssueDetailPage.tsx',
    ])
      expect(src(f), f).toMatch(/kbd-hint/);
    for (const f of [
      'components/layout/ShortcutsDialog.tsx',
      'features/docs/DocumentationPage.tsx',
    ])
      expect(src(f), f).not.toMatch(/kbd-hint/);
  });
  it('nút nổi tránh thanh home iOS (hằng vị trí dùng env(safe-area-inset-bottom))', () =>
    expect(src('lib/layoutTokens.ts')).toMatch(/safe-area-inset-bottom/));
  it('toast dưới lg tránh thanh tab đáy (hằng riêng có safe-area-inset-bottom)', () =>
    expect(src('lib/layoutTokens.ts')).toMatch(
      /TOAST_BOTTOM_MOBILE_CSS[^;]*env\(safe-area-inset-bottom\)/,
    ));
  it('dải menu phụ cuộn ngang có dấu hiệu còn nội dung', () => {
    for (const f of [
      'features/settings/SettingsLayout.tsx',
      'features/manage/ManageLayout.tsx',
      'features/connect/ConnectLayout.tsx',
      'features/integrations/IntegrationsPage.tsx',
      'features/project-config/ProjectConfigPage.tsx',
    ])
      expect(src(f), f).toMatch(/scroll-fade-x/);
  });

  it('chip lọc/Báo lỗi trên Board và dòng Việc chờ có vùng bấm cảm ứng mở rộng', () => {
    for (const f of [
      'features/quick-filters/QuickFilterChips.tsx',
      'features/quick-filters/AssigneeFilter.tsx',
      'features/board/BoardPage.tsx',
    ])
      expect(src(f), f).toMatch(/CHIP_TOUCH_HIT/);
    expect(src('features/issues/peek/IssueKeyLink.tsx')).toMatch(/LINK_TOUCH_HIT/);
  });
  it('dòng Việc chờ có dấu hiệu quá hạn không chỉ là màu viền (dưới sm)', () =>
    expect(src('features/backlog/IssueRow.tsx')).toMatch(/<DueBadge[^>]*sm:hidden/));

  it('bộ đo mobile có chế độ --dialogs và allowlist mỗi mục có lý do', () => {
    const script = readFileSync(join(__dirname, '..', '..', 'scripts', 'mobile-audit.mjs'), 'utf8');
    expect(script).toMatch(/DIALOG_SCENARIOS/);
    for (const name of ['tao-cong-viec', 'bao-loi-co-ban', 'cmd-k', 'tao-vai-tro', 'okr-check-in'])
      expect(script).toContain(`'${name}'`);
    const allow = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'scripts', 'mobile-audit.allow.json'), 'utf8'),
    ) as Record<string, string>;
    for (const [k, why] of Object.entries(allow)) expect(why.length, k).toBeGreaterThan(20);
  });
  it('bộ đo mobile kiểm thanh tab đáy (hiện + không bị phần tử fixed/main chồng) và shot.mjs --open-nav mở sheet "Tôi"', () => {
    const audit = readFileSync(join(__dirname, '..', '..', 'scripts', 'mobile-audit.mjs'), 'utf8');
    expect(audit).toMatch(/bottom-bar-missing/);
    expect(audit).toMatch(/bottom-bar-overlap/);
    const allow = readFileSync(
      join(__dirname, '..', '..', 'scripts', 'mobile-audit.allow.json'),
      'utf8',
    );
    expect(allow).not.toMatch(/FAB phủ/); // ngoại lệ cũ: nút nổi không còn dưới lg
    const shot = readFileSync(join(__dirname, '..', '..', 'scripts', 'shot.mjs'), 'utf8');
    expect(shot).toMatch(/name: 'Tôi'/);
    expect(shot).not.toMatch(/Mở menu/);
  });
  it('khung flex-wrap chứa chip có gap-y ≥ 16px trên cảm ứng (hai vùng bấm 44px của hai hàng không chồng)', () => {
    for (const f of [
      'features/quick-filters/QuickFilterChips.tsx',
      'features/activity/ActivityPanel.tsx',
      'features/board/BoardPage.tsx',
      'features/backlog/BacklogPage.tsx',
    ])
      expect(src(f), f).toMatch(/CHIP_ROW_GAP_COARSE/);
    // 28 (chip) + 2×8 (mở rộng) = 44 ≤ bước hàng 28 + 16
    expect(28 + 2 * 8).toBeLessThanOrEqual(28 + 16);
    expect(src('lib/touchHit.ts')).toMatch(
      /CHIP_ROW_GAP_COARSE\s*=\s*'\[@media\(pointer:coarse\)\]:gap-y-4'/,
    );
  });
  it('class tên chương trình ở Danh mục không có token hỏng (focus-visible trần / sm:flex-1:outline-none)', () => {
    const f = src('features/portfolio/PortfolioPage.tsx');
    expect(f).not.toMatch(/focus-visible sm:/);
    expect(f).not.toMatch(/flex-1:outline/);
    expect(f).toMatch(/sm:flex-1 focus-visible:outline-none/);
  });
});

describe('gợi ý phím trên cảm ứng (.kbd-hint)', () => {
  it('mọi gợi ý phím "Ctrl/Cmd+Enter" / "Ctrl+S" hiển thị trong features/ nằm trong phần tử .kbd-hint (cảm ứng không có bàn phím)', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)) out.push(p);
      }
      return out;
    };
    const HINT = /(Ctrl|Cmd|⌘)[^<{]*\+\s*(Enter|S)\b/;
    // Phần tử `.kbd-hint` mở trước chữ phím tối đa vài dòng (span mở rồi chữ xuống dòng).
    const WINDOW = 6;
    const bad: string[] = [];
    for (const f of walk(join(__dirname, '..', 'features'))) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((raw, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(raw)) return; // dòng comment
        const code = raw.replace(/\s\/\/.*$/, ''); // comment cuối dòng
        if (!HINT.test(code)) return;
        const near = lines.slice(Math.max(0, i - WINDOW), i + 1).join('\n');
        if (!/kbd-hint/.test(near)) bad.push(`${f.split('/src/')[1]}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
  it('gợi ý phím có `.kbd-hint` KHÔNG kèm `sm:block` (utility này thắng .kbd-hint, tablet cảm ứng vẫn thấy) — dùng `max-sm:hidden`', () => {
    for (const f of [
      'features/intake/ReportIssueModal.tsx',
      'features/issues/CreateIssueModal.tsx',
    ])
      expect(src(f), f).toMatch(/kbd-hint[^"]*max-sm:hidden/);
    expect(src('features/intake/ReportIssueModal.tsx')).not.toMatch(/kbd-hint[^"]*sm:block/);
    expect(src('features/issues/CreateIssueModal.tsx')).not.toMatch(/kbd-hint[^"]*sm:block/);
  });
  it('footer sửa nội tuyến dùng `mr-auto` cho gợi ý phím thì container có `justify-end` (ẩn gợi ý không đẩy nút sang trái)', () => {
    for (const f of [
      'features/issue-edit/CommentsSection.tsx',
      'features/issue-edit/AcceptanceCriteria.tsx',
      'features/issue-edit/DescriptionEditor.tsx',
      'features/wiki/WikiPage.tsx',
    ])
      expect(src(f), f).toMatch(/flex items-center justify-end gap-2/);
  });
});
