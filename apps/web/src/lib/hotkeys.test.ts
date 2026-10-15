import { describe, expect, it } from 'vitest';
import { isDialogOpen, isOverlayOpen, isTypingTarget, isWorklogHotkey } from './hotkeys';

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
