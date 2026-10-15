import { describe, expect, it } from 'vitest';
import {
  isDialogOpen,
  isOverlayOpen,
  isTypingTarget,
  isCommentHotkey,
  isWorklogHotkey,
  shouldClearSelectionOnEscape,
  hasDraftText,
  shouldClosePeekOnEscape,
  shouldIgnoreGlobalHotkey,
} from './hotkeys';

const ev = (
  over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) => ({ key: 'w', metaKey: false, ctrlKey: false, altKey: false, ...over });
const ctx = (over: Partial<{ typing: boolean; dialogOpen: boolean; canLog: boolean }> = {}) => ({
  typing: false,
  dialogOpen: false,
  canLog: true,
  ...over,
});

describe('isWorklogHotkey', () => {
  it('w / W thường, có quyền, không gõ, không dialog → true', () => {
    expect(isWorklogHotkey(ev(), ctx())).toBe(true);
    expect(isWorklogHotkey(ev({ key: 'W' }), ctx())).toBe(true);
  });
  it('phím khác → false', () => expect(isWorklogHotkey(ev({ key: 'x' }), ctx())).toBe(false));
  it('có modifier (⌘W đóng tab…) → false', () => {
    expect(isWorklogHotkey(ev({ metaKey: true }), ctx())).toBe(false);
    expect(isWorklogHotkey(ev({ ctrlKey: true }), ctx())).toBe(false);
    expect(isWorklogHotkey(ev({ altKey: true }), ctx())).toBe(false);
  });
  it('đang gõ / có dialog mở / không có quyền → false', () => {
    expect(isWorklogHotkey(ev(), ctx({ typing: true }))).toBe(false);
    expect(isWorklogHotkey(ev(), ctx({ dialogOpen: true }))).toBe(false);
    expect(isWorklogHotkey(ev(), ctx({ canLog: false }))).toBe(false);
  });
});

describe('isCommentHotkey', () => {
  const k = (
    key: string,
    mod: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
  ) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mod });
  const ok = { typing: false, dialogOpen: false, canComment: true };
  it('m / M không modifier → true', () => {
    expect(isCommentHotkey(k('m'), ok)).toBe(true);
    expect(isCommentHotkey(k('M'), ok)).toBe(true);
  });
  it('đang gõ, có dialog mở, hoặc không có quyền bình luận → false', () => {
    expect(isCommentHotkey(k('m'), { ...ok, typing: true })).toBe(false);
    expect(isCommentHotkey(k('m'), { ...ok, dialogOpen: true })).toBe(false);
    expect(isCommentHotkey(k('m'), { ...ok, canComment: false })).toBe(false);
  });
  it('có modifier hoặc phím khác → false', () => {
    expect(isCommentHotkey(k('m', { metaKey: true }), ok)).toBe(false);
    expect(isCommentHotkey(k('m', { ctrlKey: true }), ok)).toBe(false);
    expect(isCommentHotkey(k('m', { altKey: true }), ok)).toBe(false);
    expect(isCommentHotkey(k('n'), ok)).toBe(false);
  });
});

/** Giả `document.querySelector`: khớp nếu selector liệt kê chứa đúng một trong các selector "đang có". */
const rootWith = (...present: string[]) => ({
  querySelector: (sel: string) =>
    sel
      .split(',')
      .map((x) => x.trim())
      .some((x) => present.includes(x))
      ? ({} as Element)
      : null,
});

describe('isDialogOpen / isOverlayOpen', () => {
  const OPEN = '[role="dialog"][data-state="open"]';
  it('không có gì / dialog đã đóng (data-state=closed) → false', () => {
    expect(isDialogOpen(rootWith())).toBe(false);
    expect(isOverlayOpen(rootWith())).toBe(false);
    // dialog closed không khớp selector `open` nên querySelector trả null
    expect(isDialogOpen(rootWith('[role="dialog"][data-state="closed"]'))).toBe(false);
    expect(isOverlayOpen(rootWith('[role="dialog"][data-state="closed"]'))).toBe(false);
  });
  it('dialog mở → true cho cả hai', () => {
    expect(isDialogOpen(rootWith(OPEN))).toBe(true);
    expect(isOverlayOpen(rootWith(OPEN))).toBe(true);
  });
  it('menu/listbox/popper mở → chỉ isOverlayOpen true', () => {
    for (const sel of [
      '[role="menu"][data-state="open"]',
      '[role="listbox"][data-state="open"]',
      '[role="alertdialog"][data-state="open"]',
      '[data-radix-popper-content-wrapper]',
    ]) {
      expect(isOverlayOpen(rootWith(sel))).toBe(true);
      expect(isDialogOpen(rootWith(sel))).toBe(false);
    }
  });
});

describe('isTypingTarget', () => {
  const el = (over: Record<string, unknown>) =>
    ({ tagName: 'DIV', isContentEditable: false, closest: () => null, ...over }) as never;
  it('input/textarea/select → true', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(isTypingTarget(el({ tagName }))).toBe(true);
  });
  it('contenteditable (chính nó hoặc tổ tiên) → true', () => {
    expect(isTypingTarget(el({ isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(el({ closest: () => ({}) }))).toBe(true);
  });
  it('phần tử thường / null / không phải phần tử → false', () => {
    expect(isTypingTarget(el({}))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});

describe('shouldIgnoreGlobalHotkey (c / g / / / ?)', () => {
  const k = { metaKey: false, ctrlKey: false, altKey: false };
  it('bình thường → không bỏ qua', () => {
    expect(shouldIgnoreGlobalHotkey(k, { typing: false, overlayOpen: false })).toBe(false);
  });
  it('đang gõ, có modifier hoặc lớp phủ mở → bỏ qua', () => {
    expect(shouldIgnoreGlobalHotkey(k, { typing: true, overlayOpen: false })).toBe(true);
    expect(
      shouldIgnoreGlobalHotkey({ ...k, metaKey: true }, { typing: false, overlayOpen: false }),
    ).toBe(true);
    expect(shouldIgnoreGlobalHotkey(k, { typing: false, overlayOpen: true })).toBe(true);
  });
  it('DropdownMenu đang mở (role=menu, không phải dialog) → phím chữ là typeahead, bị bỏ qua', () => {
    const menuOnly = {
      querySelector: (sel: string) =>
        sel.includes('[role="menu"][data-state="open"]') ? {} : null,
    };
    const overlayOpen = isOverlayOpen(menuOnly);
    expect(isDialogOpen({ querySelector: () => null })).toBe(false);
    expect(shouldIgnoreGlobalHotkey(k, { typing: false, overlayOpen })).toBe(true);
  });
});

describe('shouldClearSelectionOnEscape (thanh thao tác hàng loạt)', () => {
  it('Esc thường → xoá vùng chọn', () => {
    expect(shouldClearSelectionOnEscape({ key: 'Escape', defaultPrevented: false }, false)).toBe(
      true,
    );
  });
  it('Esc đã được xử lý (popover/kéo-thả phím) hoặc lớp phủ đang mở → giữ vùng chọn', () => {
    expect(shouldClearSelectionOnEscape({ key: 'Escape', defaultPrevented: true }, false)).toBe(
      false,
    );
    expect(shouldClearSelectionOnEscape({ key: 'Escape', defaultPrevented: false }, true)).toBe(
      false,
    );
  });
  it('phím khác → không', () => {
    expect(shouldClearSelectionOnEscape({ key: 'a', defaultPrevented: false }, false)).toBe(false);
  });
});

describe('Esc với panel xem nhanh', () => {
  const esc = (o: Partial<{ key: string; defaultPrevented: boolean }> = {}) => ({
    key: 'Escape',
    defaultPrevented: false,
    ...o,
  });
  it('đóng panel khi không có lớp phủ, chưa ai xử lý', () => {
    expect(shouldClosePeekOnEscape(esc(), { overlayOpen: false })).toBe(true);
  });
  it('không đóng khi lớp phủ đang mở hoặc Esc đã được xử lý (bỏ chọn hàng loạt / huỷ sửa tiêu đề)', () => {
    expect(shouldClosePeekOnEscape(esc(), { overlayOpen: true })).toBe(false);
    expect(shouldClosePeekOnEscape(esc({ defaultPrevented: true }), { overlayOpen: false })).toBe(
      false,
    );
  });
  it('phím khác Esc không đóng', () => {
    expect(shouldClosePeekOnEscape(esc({ key: 'Enter' }), { overlayOpen: false })).toBe(false);
  });
  it('bỏ chọn hàng loạt không chạy khi Esc đến từ trong panel', () => {
    expect(shouldClearSelectionOnEscape(esc(), false, { fromPeek: true })).toBe(false);
    expect(shouldClearSelectionOnEscape(esc(), false, { fromPeek: false })).toBe(true);
    expect(shouldClearSelectionOnEscape(esc(), false)).toBe(true); // chữ ký cũ vẫn đúng
  });
});

describe('Esc: kéo bằng phím và nháp chưa gửi', () => {
  const esc = { key: 'Escape', defaultPrevented: false };
  it('đang kéo → Esc chỉ huỷ kéo, không xoá vùng chọn và không đóng panel', () => {
    expect(shouldClearSelectionOnEscape(esc, false, { dragging: true })).toBe(false);
    expect(shouldClosePeekOnEscape(esc, { overlayOpen: false, dragging: true })).toBe(false);
    expect(shouldClearSelectionOnEscape(esc, false, { dragging: false })).toBe(true);
  });
  it('Esc từ ô đang có nháp → không đóng panel (chỉ rời ô)', () => {
    expect(shouldClosePeekOnEscape(esc, { overlayOpen: false, draftFocused: true })).toBe(false);
    expect(shouldClosePeekOnEscape(esc, { overlayOpen: false, draftFocused: false })).toBe(true);
  });
  it('hasDraftText: ô có chữ → có nháp; ô trống/chỉ khoảng trắng/phần tử khác → không', () => {
    expect(hasDraftText({ tagName: 'TEXTAREA', value: 'Viết dở' })).toBe(true);
    expect(hasDraftText({ tagName: 'INPUT', value: 'bước 1' })).toBe(true);
    expect(hasDraftText({ tagName: 'INPUT', value: '   ' })).toBe(false);
    expect(hasDraftText({ tagName: 'TEXTAREA', value: '' })).toBe(false);
    expect(hasDraftText({ tagName: 'DIV', isContentEditable: true, textContent: 'abc' })).toBe(
      true,
    );
    expect(hasDraftText({ tagName: 'BUTTON' })).toBe(false);
    expect(hasDraftText(null)).toBe(false);
  });
});
