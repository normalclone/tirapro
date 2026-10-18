import { readFileSync } from 'node:fs';
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
  it('gợi ý phím <kbd> ẩn trên thiết bị cảm ứng (hover:none + pointer:coarse)', () =>
    expect(css).toMatch(
      /@media \(hover: none\) and \(pointer: coarse\)\s*\{[^@]*?kbd\s*\{[^}]*display:\s*none/,
    ));
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
