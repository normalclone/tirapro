import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SelectCheckbox } from './SelectCheckbox';

const SRC = join(__dirname, '../..');
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const box = (o: Partial<Parameters<typeof SelectCheckbox>[0]> = {}) =>
  renderToStaticMarkup(
    <SelectCheckbox
      issueKey="DEMO-1"
      checked={false}
      alwaysVisible={false}
      onToggle={() => undefined}
      onRange={() => undefined}
      {...o}
    />,
  );

describe('ô chọn trên thẻ (SelectCheckbox)', () => {
  it('tên truy cập "Chọn {MÃ}", trạng thái checked theo prop, không phải nút xem nhanh', () => {
    const h = box();
    expect(h).toContain('aria-label="Chọn DEMO-1"');
    expect(h).not.toContain('checked');
    expect(h).toContain('data-no-peek');
    expect(box({ checked: true })).toContain('checked');
  });
  it('ẩn tới khi rê/focus thẻ; luôn hiện khi đang có lựa chọn; luôn hiện + vùng bấm 44px trên cảm ứng', () => {
    const hidden = box();
    expect(hidden).toContain('opacity-0');
    expect(hidden).toContain('group-hover/row:opacity-100');
    expect(hidden).toContain('group-focus-within/row:opacity-100');
    const shown = box({ alwaysVisible: true });
    expect(shown).not.toContain('opacity-0');
    expect(hidden).toContain('[@media(pointer:coarse)]:opacity-100');
    // ô 20px, viền 1px mỗi bên → vùng trong 18px + 2×13px = 44px
    expect(hidden).toContain('[@media(pointer:coarse)]:after:-inset-[13px]');
  });
  it('không để cử chỉ lan sang thẻ (kéo/xem nhanh) — như nút "…"', () => {
    const s = src('features/bulk/SelectCheckbox.tsx');
    for (const ev of ['onMouseDown', 'onTouchStart', 'onPointerDown', 'onClick'])
      expect(s).toContain(`${ev}=`);
    // CHỈ chặn phím của dòng/thẻ (Enter/Space/mũi tên). Phím toàn cục (Cmd+K, ?, g-chord, c, j/k, Esc) phải tới window:
    // `stopPropagation` của React dừng cả sự kiện gốc ở root nên chặn mọi phím làm chết `useGlobalHotkeys`/CommandPalette.
    expect(s).toContain('onKeyDown={stopRowKeys}');
    expect(s).not.toMatch(/e\.key !== 'Escape'/);
    expect(s).toContain('if (e.shiftKey) onRange()');
  });
});

describe('Bảng việc: chọn nhiều', () => {
  const card = src('features/board/Card.tsx');
  it('thẻ đọc lựa chọn qua kho (không qua prop) nên memo của thẻ giữ nguyên', () => {
    expect(card).toContain('useIsSelected(bulk?.store, issue.id)');
    expect(card).toContain('useHasSelection(bulk?.store)');
    const cmp = card.slice(card.indexOf('(prev, next) =>'));
    expect(cmp).not.toMatch(/selected|selecting|bulk/);
    // CardProps không có prop chọn
    const props = card.slice(
      card.indexOf('interface CardProps'),
      card.indexOf('export const Card'),
    );
    expect(props).not.toMatch(/select/i);
  });
  it('Shift/Cmd/Ctrl+click qua selectGesture ở pha bắt, bỏ qua ô chọn/nút "…", không bôi đen chữ khi Shift', () => {
    expect(card).toContain("selectGesture(e, !!t.closest('a'))");
    expect(card).toContain("t.closest('[data-no-peek], button')");
    expect(card).toContain('onClickCapture');
    expect(card).toContain('onMouseDownCapture');
    // Mũi tên phát từ phần tử BÊN TRONG thẻ (ô chọn, nút "…") không được dời thẻ.
    expect(card).toMatch(/if \(e\.target !== e\.currentTarget\) return;[\s\S]{0,200}ArrowUp/);
    expect(card).toContain("'data-selected'");
  });
  it('thẻ đã chọn: viền + nền primary; bản overlay kéo không có ô chọn', () => {
    expect(card).toContain("selected ? 'border-primary bg-primary-subtle'");
    const overlay = src('features/board/BoardDnd.tsx');
    expect(overlay).not.toContain('selectBox');
  });
  const page = src('features/board/BoardPage.tsx');
  it('BoardPage: thứ tự hiển thị cho Shift+click, bỏ id không còn trên bảng, ngữ cảnh ổn định, dock chỉ khi đang chọn', () => {
    expect(page).toContain('boardVisualOrder(');
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*pruneSelection\(new Set\(visualOrder\)\);\s*\}, \[/,
    );
    expect(page).toContain('<BulkSelectionContext.Provider value={bulkApi}>');
    expect(page).toMatch(/canBulk && sel\.selected\.size > 0 && project && \(\s*<BoardBulkDock/);
  });
  it('BoardBulkDock: một projectId + boardId (kiểm WIP), làm mới cache bảng lọc, không có Sprint/Epic', () => {
    const d = src('features/board/BoardBulkDock.tsx');
    expect(d).toContain('projectId: project.id');
    expect(d).toContain('boardId,');
    expect(d).toContain('keys.issues.byBoard(boardId)');
    expect(d).toContain('placement="docked"');
    expect(d).not.toContain('onMoveToSprint');
    expect(d).not.toContain('onSetEpic');
    expect(src('features/backlog/api.ts')).toContain('...(boardId ? { boardId } : {})');
  });
});

describe('BulkDock dùng chung', () => {
  const dock = src('features/bulk/BulkDock.tsx');
  it('không kính mờ; docked là con flex (không fixed) nằm trên thanh tab đáy', () => {
    expect(dock).not.toContain('backdrop-blur');
    expect(dock).toContain("placement === 'sticky'");
    expect(dock).not.toMatch(/\bfixed\b/);
    expect(dock).toContain('motion-reduce:animate-none');
  });
  it('điện thoại: MỘT hàng (không cuộn ngang) + "…" mở sheet đáy; Bỏ chọn có tên truy cập', () => {
    expect(dock).toContain('aria-label="Thêm thao tác"');
    expect(dock).toContain('placement="bottom"');
    expect(dock).toContain('flex-nowrap');
    expect(dock).not.toContain('overflow-x-auto');
    expect(dock).toContain('aria-label="Bỏ chọn tất cả"');
  });
  it('Trạng thái ở hàng gọn là 44px trên cảm ứng (như nút "…")', () => {
    expect(dock).toContain("'h-8 w-auto [@media(pointer:coarse)]:h-11'");
  });
  it('Esc bỏ chọn tôn trọng ô đang gõ / sửa tại chỗ (isTypingTarget) và lớp phủ đang mở', () => {
    expect(dock).toContain('typing: isTypingTarget(e.target)');
    expect(dock).toContain('isOverlayOpen()');
  });
});
