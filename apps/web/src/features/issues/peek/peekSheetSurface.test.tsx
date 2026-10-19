import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Root as SheetRoot } from '@radix-ui/react-dialog';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  findPeekSource,
  nextSnap,
  PEEK_DESKTOP_QUERY,
  peekNavPlan,
  peekSurface,
  sheetClass,
  sheetEscapeAction,
  snapToggleLabel,
} from './peekSheetLogic';
import { PeekSheetHandle } from './PeekSheet';

const WEB = join(__dirname, '../../../..');
const src = (rel: string) => readFileSync(join(WEB, 'src', rel), 'utf8');

describe('peekSurface — dưới md là sheet, từ md giữ panel phi-modal', () => {
  it('mapping', () => {
    expect(peekSurface(false)).toBe('sheet');
    expect(peekSurface(true)).toBe('panel');
  });
  it('truy vấn là md (768px), không phải lg', () => {
    expect(PEEK_DESKTOP_QUERY).toBe('(min-width: 768px)');
  });
});

describe('nấc sheet', () => {
  it('đổi qua lại nửa ↔ đầy', () => {
    expect(nextSnap('half')).toBe('full');
    expect(nextSnap('full')).toBe('half');
  });
  it('nhãn nút theo nấc hiện tại', () => {
    expect(snapToggleLabel('half')).toBe('Mở rộng');
    expect(snapToggleLabel('full')).toBe('Thu gọn');
  });
  it('class chiều cao: nửa 50dvh, đầy trừ safe-area trên; có chuyển động ease-out-expo + motion-reduce; gỡ max-h 85dvh', () => {
    const half = sheetClass('half');
    const full = sheetClass('full');
    expect(half).toContain('h-[50dvh]');
    expect(full).toContain('h-[calc(100dvh-env(safe-area-inset-top))]');
    for (const c of [half, full]) {
      expect(c).toContain('transition-[height]');
      expect(c).toContain('ease-out-expo');
      expect(c).toContain('motion-reduce:transition-none');
      expect(c).toContain('max-h-none');
      expect(c).not.toMatch(/bounce|spring|elastic/);
    }
  });
});

describe('sheetEscapeAction', () => {
  const base = { isComposing: false, inInlineEdit: false, draftFocused: false };
  it('Esc thường → đóng', () => expect(sheetEscapeAction(base)).toBe('close'));
  it('bộ gõ IME đang soạn → giữ nguyên (Esc thuộc bộ gõ)', () =>
    expect(sheetEscapeAction({ ...base, isComposing: true })).toBe('keep'));
  it('đang sửa tiêu đề tại chỗ → giữ (ô tự huỷ sửa)', () =>
    expect(sheetEscapeAction({ ...base, inInlineEdit: true })).toBe('keep'));
  it('ô nhập đang có chữ chưa gửi → chỉ rời ô', () =>
    expect(sheetEscapeAction({ ...base, draftFocused: true })).toBe('blur'));
  it('IME thắng cả nháp', () =>
    expect(sheetEscapeAction({ ...base, isComposing: true, draftFocused: true })).toBe('keep'));
});

describe('peekNavPlan — lịch sử trình duyệt của peek', () => {
  it('mở từ trạng thái đóng trên sheet → push (back sẽ đóng sheet)', () => {
    expect(peekNavPlan({ sheet: true, hasPeek: false, pushed: false, key: 'A-1' })).toBe('push');
  });
  it('mở trên desktop → replace như cũ', () => {
    expect(peekNavPlan({ sheet: false, hasPeek: false, pushed: false, key: 'A-1' })).toBe(
      'replace',
    );
  });
  it('đổi việc khi đang mở → replace (không chồng lịch sử khi bấm ‹ ›)', () => {
    expect(peekNavPlan({ sheet: true, hasPeek: true, pushed: true, key: 'A-2' })).toBe('replace');
  });
  it('đóng khi mục lịch sử do mình đẩy → back', () => {
    expect(peekNavPlan({ sheet: true, hasPeek: true, pushed: true, key: null })).toBe('back');
  });
  it('đóng khi vào thẳng bằng URL (không có mục do mình đẩy) → replace, không rời trang', () => {
    expect(peekNavPlan({ sheet: true, hasPeek: true, pushed: false, key: null })).toBe('replace');
    expect(peekNavPlan({ sheet: false, hasPeek: true, pushed: false, key: null })).toBe('replace');
  });
  it('đóng khi chưa mở → không làm gì (đóng hai lần không lùi hai bước)', () => {
    expect(peekNavPlan({ sheet: true, hasPeek: false, pushed: true, key: null })).toBe('noop');
  });
});

describe('findPeekSource — trả focus về thẻ/dòng đã mở', () => {
  const el = (name: string) => ({ name }) as unknown as HTMLElement;
  const rootWith = (map: Record<string, HTMLElement | null>) =>
    ({ querySelector: (s: string) => map[s] ?? null }) as unknown as ParentNode;
  it('ưu tiên phần tử [data-nav-item][data-issue-key]', () => {
    const a = el('nav');
    expect(findPeekSource(rootWith({ '[data-nav-item][data-issue-key="T-1"]': a }), 'T-1')).toBe(a);
  });
  it('dòng bọc li[data-issue-key] > [data-nav-item]', () => {
    const b = el('inner');
    expect(findPeekSource(rootWith({ '[data-issue-key="T-1"] [data-nav-item]': b }), 'T-1')).toBe(
      b,
    );
  });
  it('không còn trong DOM (ảo hoá) → null; root null → null', () => {
    expect(findPeekSource(rootWith({}), 'T-1')).toBeNull();
    expect(findPeekSource(null, 'T-1')).toBeNull();
  });
});

describe('PeekSheetHandle', () => {
  const html = (snap: 'half' | 'full') =>
    renderToStaticMarkup(
      <SheetRoot open>
        <PeekSheetHandle snap={snap} onToggle={() => {}} />
      </SheetRoot>,
    );
  it('là button thật, tên theo nấc, aria-expanded, vùng bấm 44px', () => {
    const half = html('half');
    expect(half).toMatch(/<button[^>]*type="button"/);
    expect(half).toContain('aria-label="Mở rộng"');
    expect(half).toContain('aria-expanded="false"');
    expect(half).toContain('h-11');
    const full = html('full');
    expect(full).toContain('aria-label="Thu gọn"');
    expect(full).toContain('aria-expanded="true"');
  });
  it('có nút đóng 44px tên "Đóng xem nhanh"', () => {
    expect(html('half')).toContain('aria-label="Đóng xem nhanh"');
  });
});

describe('nối dây', () => {
  const panel = src('features/issues/peek/IssuePeekPanel.tsx');
  const sheet = src('features/issues/peek/PeekSheet.tsx');
  const dialog = src('components/ui/Dialog.tsx');
  const hook = src('features/issues/peek/useIssuePeek.ts');
  it('PeekShell chọn bề mặt bằng useMediaQuery(PEEK_DESKTOP_QUERY); panel render PeekSheet khi `sheet`', () => {
    const shell = src('features/issues/peek/PeekShell.tsx');
    expect(shell).toContain('useMediaQuery(PEEK_DESKTOP_QUERY');
    expect(shell).toContain('sheet={sheet}');
    expect(panel).toContain('<PeekSheet');
  });
  it('sheet giữ cây sau khi đóng để Radix chạy hiệu ứng đóng; panel desktop gỡ ngay (shownKey chỉ giữ khi sheet)', () => {
    const shell = src('features/issues/peek/PeekShell.tsx');
    expect(shell).toContain('useRetainedFor(peekKey, SHEET_EXIT_MS)');
    expect(shell).toMatch(/peekKey \?\? \(sheet \? retainedKey : null\)/);
    expect(shell).toContain('open={!!peekKey}');
    expect(sheet).toContain('open={open}');
  });
  it('Esc của window chỉ chạy ở panel (sheet để Radix xử lý) — không đóng hai lần', () => {
    expect(panel).toMatch(/if \(sheet\) return;/);
  });
  it('sheet dùng Dialog placement="bottom" + handle + hideClose, đánh dấu data-peek-panel, nhận Esc có điều kiện', () => {
    expect(sheet).toContain('placement="bottom"');
    expect(sheet).toContain('handle={');
    expect(sheet).toContain('hideClose');
    expect(sheet).toContain('data-peek-panel');
    expect(sheet).toContain('sheetEscapeAction(');
    expect(panel).toContain('findPeekSource(');
    expect(sheet).toContain('onCloseAutoFocus');
    expect(sheet).not.toMatch(/pointermove|setPointerCapture/); // không kéo-thả nấc
  });
  it('Dialog có prop handle/hideClose tuỳ chọn; mặc định không đổi (tay nắm trang trí + nút X)', () => {
    expect(dialog).toContain('handle?: ReactNode');
    expect(dialog).toContain('hideClose?: boolean');
    expect(dialog).toContain('aria-label="Đóng"');
  });
  it('useIssuePeek chọn push/replace/back qua peekNavPlan và giữ state khi đổi việc', () => {
    expect(hook).toContain('peekNavPlan(');
    expect(hook).toContain('peekPushed');
  });
  it('DESIGN.md ghi đúng z-index dropdown=1350 như tailwind.config', () => {
    const design = readFileSync(join(WEB, '../../DESIGN.md'), 'utf8');
    expect(design).toContain('dropdown=1350');
    expect(design).not.toContain('dropdown=1000');
    const tw = readFileSync(join(WEB, 'tailwind.config.ts'), 'utf8');
    expect(tw).toContain("dropdown: '1350'");
  });
});
