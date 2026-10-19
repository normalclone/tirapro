import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { IssueRowMenuButton, ROW_MENU_BUTTON_CLS } from './IssueContextMenu';

const WEB = join(__dirname, '../../../..'); // apps/web
const src = (rel: string) => readFileSync(join(WEB, 'src', rel), 'utf8');
const here = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('phụ thuộc @radix-ui/react-context-menu', () => {
  it('ghim đúng 2.3.1 (không dấu mũ/tilde)', () => {
    const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@radix-ui/react-context-menu']).toBe('2.3.1');
  });
  it('lockfile chỉ còn MỘT bản @radix-ui/react-menu (cùng bản với dropdown-menu)', () => {
    const lock = readFileSync(join(WEB, '../../pnpm-lock.yaml'), 'utf8');
    const versions = [...lock.matchAll(/^ {2}'@radix-ui\/react-menu@([^'(]+)'/gm)].map((m) => m[1]);
    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).toBe('2.1.18');
  });
});

describe('IssueRowMenuButton', () => {
  const issue = { id: 'i1', key: 'TP-7' } as IssueDto;
  const html = renderToStaticMarkup(<IssueRowMenuButton issue={issue} surface="board" />);
  it('tên truy cập "Thao tác cho {MÃ}", là nút menu, không kích hoạt xem nhanh của dòng', () => {
    expect(html).toMatch(/<button[^>]*aria-label="Thao tác cho TP-7"/);
    expect(html).toMatch(/aria-haspopup="menu"/);
    expect(html).toContain('data-no-peek');
  });
  it('ẩn tới khi rê/focus dòng, luôn hiện + vùng bấm 44px trên cảm ứng', () => {
    expect(ROW_MENU_BUTTON_CLS).toContain('opacity-0');
    expect(ROW_MENU_BUTTON_CLS).toContain('group-hover/row:opacity-100');
    expect(ROW_MENU_BUTTON_CLS).toContain('group-focus-within/row:opacity-100');
    expect(ROW_MENU_BUTTON_CLS).toContain('focus-visible:opacity-100');
    expect(ROW_MENU_BUTTON_CLS).toContain('[@media(pointer:coarse)]:opacity-100');
    // h-6 (24px) + 2×10px = 44px
    expect(ROW_MENU_BUTTON_CLS).toContain('h-6');
    expect(ROW_MENU_BUTTON_CLS).toContain('[@media(pointer:coarse)]:after:-inset-2.5');
  });
});

describe('IssueContextMenu (đọc source)', () => {
  const s = here('IssueContextMenu.tsx');
  it('tắt trên pointer: coarse (nhấn giữ thuộc về dnd-kit) và chặn nhấn giữ cảm ứng/bút trên máy lai', () => {
    expect(s).toContain('useCoarsePointer()');
    expect(s).toContain('disabled={coarse}');
    expect(s).toMatch(/pointerType !== 'mouse'[\s\S]{0,80}preventDefault/);
  });
  it('máy lai: ghi pointerType ở pha bắt; cử chỉ cuối là cảm ứng/bút → chặn contextmenu; bàn phím luôn được mở', () => {
    expect(s).toContain('onPointerDownCapture');
    expect(s).toContain('lastGesture.current = e.pointerType');
    expect(s).toContain("lastGesture.current = 'keyboard'");
    expect(s).toContain('shouldSuppressContextMenu(lastGesture.current)');
  });
  it('nhường menu gốc khi đang gõ (isTypingTarget, pha bắt)', () => {
    expect(s).toContain('onContextMenuCapture');
    expect(s).toContain('isTypingTarget(e.target)');
  });
  it('phím trong menu không lọt vào bộ phím của dòng/thẻ', () => {
    expect((s.match(/onKeyDown=\{stopRowKeys\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // chỉ phím của dòng/thẻ; không nuốt mọi phím (Cmd+K, ?, g-chord… phải tới window)
    expect(s).not.toContain('const stopKeys');
  });
  it('nút "…" không để cử chỉ lan sang dnd-kit/dòng', () => {
    for (const ev of ['onMouseDown', 'onTouchStart', 'onPointerDown', 'onClick'])
      expect(s).toMatch(new RegExp(`${ev}=\\{\\(e\\) => e\\.stopPropagation\\(\\)\\}`));
  });
  it('một nguồn nội dung: cả hai menu dựng IssueMenuItems', () => {
    expect((s.match(/<IssueMenuItems/g) ?? []).length).toBe(2);
    expect(s).toContain('CONTEXT_KIT');
    expect(s).toContain('DROPDOWN_KIT');
  });
});

describe('IssueMenuItems / host (đọc source)', () => {
  const items = here('IssueMenuItems.tsx');
  const host = here('IssueActionHost.tsx');
  it('mục ghi giao cho host, không tự gọi mutation; không dùng mutate(…, {onError}) từng lần gọi', () => {
    expect(items).toContain('runIssueAction');
    expect(items).not.toMatch(/useUpdateIssue|useMutation|\.mutate\(/);
    expect(host).not.toMatch(/\.mutate\(/);
    expect(host).toContain('mutateAsync');
  });
  it('sao chép dùng useIssueCopy (issueUrl); xoá dùng useConfirm không requireText; trạng thái đi requestTransition', () => {
    expect(items).toContain('useIssueCopy(issue.key)');
    expect(host).toContain('useConfirm()');
    expect(host).not.toContain('requireText');
    expect(host).toContain('useIssueTransitions(latest)');
    expect(host).toContain('t.requestTransition(toStatusId)');
    expect(host).toContain('{t.dialog}');
  });
  it('ghi gửi version (OCC) của bản mới nhất', () => {
    expect((host.match(/version: latest\.version/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('host là DANH SÁCH runner, mỗi runner tự gỡ khi xong (kể cả cửa sổ Hoàn tác); hành động mới không gạt cái cũ', () => {
    expect(host).toContain('runs.map(');
    expect(host).not.toContain('(s) => s.current)');
    expect((host.match(/done\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // hẹn giờ gỡ do hàm thuần `runnerLifecycle` quyết định (hộp mở/đang chạy → huỷ hẹn)
    expect(host).toContain('runnerLifecycle(');
    expect(host).toContain('timer.cancel()');
    expect(host).not.toContain('schedule(SAFETY_MS)');
    expect(src('features/issues/menu/runnerLifecycle.ts')).toContain('UNDO_WINDOW_MS');
    expect(src('features/issues/menu/runnerLifecycle.ts')).toContain('SAFETY_MS');
  });
  it('ghi thành công → lớp phủ Bộ lọc (không invalidate /search, không refetch)', () => {
    expect(host).toContain('recordIssueChange');
    expect(host).toContain('recordIssueDeleted');
    expect(host).not.toContain('invalidateQueries');
    expect(host).not.toContain('keys.search');
    // đổi trạng thái (cả Hoàn tác) ghi ngay ở mutation dùng chung
    expect(src('features/issues/api.ts')).toContain(
      'onSuccess: (updated) => recordIssueChange(updated)',
    );
  });
  it('huỷ hộp xoá → trả focus về phần tử đã mở menu (dòng/thẻ hoặc nút "…")', () => {
    expect(host).toContain('restoreFocus(returnFocus)');
    expect(host).toMatch(/document\.activeElement[\s\S]{0,120}document\.body/);
    expect(items).toContain('returnFocus: origin?.() ?? null');
    const ctx = here('IssueContextMenu.tsx');
    expect(ctx).toContain('origin={() => origin.current}');
    expect(ctx).toContain('origin={() => buttonRef.current}');
    expect(ctx).toMatch(/closest<HTMLElement>\(\s*'\[data-nav-item\]\[data-issue-key\]'/);
  });
  it('host mount một lần ở AppShell', () => {
    expect(src('components/layout/AppShell.tsx')).toContain('<IssueActionHost />');
  });
});

describe('gắn vào các bề mặt (đọc source)', () => {
  it.each([
    ['features/board/Card.tsx', 'surface="board"'],
    ['features/backlog/IssueRow.tsx', 'surface="backlog"'],
    ['features/saved-filters/ResultsTable.tsx', 'surface="filters"'],
    ['features/tree/TreePage.tsx', 'surface="tree"'],
  ])('%s có menu chuột phải + nút "…" cùng bề mặt', (file, surface) => {
    const s = src(file);
    expect(s).toContain('<IssueContextMenu');
    expect(s).toContain('<IssueRowMenuButton');
    expect(s).toContain(surface);
    expect(s).toContain('group/row');
  });
  it('mọi hook của menu nằm trong nội dung (không có trong dòng/thẻ): dòng không gọi useIssueTransitions/useConfirm', () => {
    for (const f of [
      'features/board/Card.tsx',
      'features/backlog/IssueRow.tsx',
      'features/saved-filters/ResultsTable.tsx',
      'features/tree/TreePage.tsx',
    ]) {
      const s = src(f);
      expect(s).not.toContain('useIssueTransitions');
      expect(s).not.toContain('useConfirm');
    }
  });
  it('Card vẫn memo, so sánh không đổi vì menu (không prop mới)', () => {
    const card = src('features/board/Card.tsx');
    expect(card).toMatch(/export const Card = memo\(/);
    expect(card).not.toMatch(/prev\.menu/);
    expect(card).toContain('PEEKED_ROW_CLS');
    expect(card).toContain('peekedAttrs(peeked)');
  });
  it('Bảng việc (chuột): nút "…" nằm TRONG hàng mã (không phủ chip hạn/điểm), bản overlay/xem trước không có nút', () => {
    const card = src('features/board/Card.tsx');
    // Không có `absolute` vô điều kiện: chỉ cảm ứng mới được đưa ra góc (xem test kế).
    expect(card.replace(/\[@media\(pointer:coarse\)\]:absolute/g, '')).not.toContain(
      'absolute right-1 top-1',
    );
    // `{menu}` đứng trong hàng mã: sau SeverityBadge, trước khối người phụ trách
    expect(card).toMatch(/<SeverityBadge[\s\S]*?\{menu\}[\s\S]*?<CardAssignee/);
    expect(src('features/board/BoardDnd.tsx')).not.toContain('menu=');
    expect(src('features/board/CardDisplayPopover.tsx')).not.toContain('menu=');
  });
  it('Bảng việc (cảm ứng): nút "…" ra GÓC TRÊN PHẢI thẻ (xa tâm/tiêu đề — vùng 44px không bị Chrome hút cú chạm giữa thẻ), hàng đầu chừa chỗ', () => {
    const card = src('features/board/Card.tsx');
    const cls = /const CARD_MENU_COARSE_CLS =\s*'([^']+)'/.exec(card)?.[1] ?? '';
    expect(cls).toContain('[@media(pointer:coarse)]:absolute');
    expect(cls).toContain('[@media(pointer:coarse)]:right-1');
    expect(cls).toContain('[@media(pointer:coarse)]:top-1');
    expect(card).toContain('className={CARD_MENU_COARSE_CLS}');
    // hàng đầu (loại + chip hạn/điểm) chừa chỗ cho vùng bấm 44px chỉ khi có nút
    expect(card).toMatch(/menu && '\[@media\(pointer:coarse\)\]:pr-10'/);
    // vẫn 24px + ::after 44px (class gốc không đổi)
    expect(ROW_MENU_BUTTON_CLS).toContain('[@media(pointer:coarse)]:after:-inset-2.5');
  });
  it('Bộ lọc: phủ thay đổi lên danh sách đang hiện (không refetch), bỏ lớp phủ khi đổi nguồn', () => {
    const page = src('features/saved-filters/FiltersPage.tsx');
    expect(page).toContain('applyOverlay(shownSet?.items ?? null, overlay)');
    expect(page).toMatch(
      /clearIssueOverlay\(\);\s*return clearIssueOverlay;[\s\S]{0,40}\[active\]/,
    );
  });
  it('Bộ lọc: bấm trơn vẫn xem nhanh / Cmd-bấm tab mới (rowPeekProps nguyên vẹn), chuột phải không phải click', () => {
    const s = src('features/saved-filters/ResultsTable.tsx');
    expect(s).toContain('{...rowPeekProps(issue.key, onOpen)}');
  });
});
