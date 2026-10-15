import { describe, expect, it } from 'vitest';
import {
  clickIsOnInteractive,
  isModifiedClick,
  peekSearch,
  rowKeyAction,
  wantsNewTab,
} from './rowOpen';

const ev = (o: Partial<Parameters<typeof isModifiedClick>[0]> = {}) => ({
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  button: 0,
  ...o,
});

describe('isModifiedClick / wantsNewTab', () => {
  it('click trơn không phải modified', () => expect(isModifiedClick(ev())).toBe(false));
  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])('có phím bổ trợ / chuột giữa %o là modified', (o) =>
    expect(isModifiedClick(ev(o))).toBe(true),
  );
  it('chỉ Cmd/Ctrl/chuột giữa mới mở tab mới trên DÒNG', () => {
    expect(wantsNewTab(ev({ metaKey: true }))).toBe(true);
    expect(wantsNewTab(ev({ ctrlKey: true }))).toBe(true);
    expect(wantsNewTab(ev({ button: 1 }))).toBe(true);
    expect(wantsNewTab(ev({ shiftKey: true }))).toBe(false);
  });
});

/** Phần tử giả đủ cho clickIsOnInteractive (đi ngược parentElement tới root). */
const node = (tag: string, parent: unknown = null, attrs: string[] = []) => {
  const n: Record<string, unknown> = { tagName: tag, parentElement: parent };
  n.matches = (sel: string) =>
    sel.split(',').some((s) => s.trim() === tag.toLowerCase() || attrs.includes(s.trim()));
  return n;
};

describe('clickIsOnInteractive', () => {
  const root = node('DIV');
  it('click vào chính dòng / span trong dòng => không phải tương tác', () => {
    expect(clickIsOnInteractive(root as never, root as never)).toBe(false);
    expect(clickIsOnInteractive(node('SPAN', root) as never, root as never)).toBe(false);
  });
  it('click vào button/a/input trong dòng => tương tác', () => {
    expect(clickIsOnInteractive(node('BUTTON', root) as never, root as never)).toBe(true);
    const btn = node('BUTTON', root);
    expect(clickIsOnInteractive(node('SVG', btn) as never, root as never)).toBe(true);
    expect(clickIsOnInteractive(node('INPUT', root) as never, root as never)).toBe(true);
  });
  it('đánh dấu data-no-peek cũng là tương tác', () => {
    expect(
      clickIsOnInteractive(node('DIV', root, ['[data-no-peek]']) as never, root as never),
    ).toBe(true);
  });
});

describe('rowKeyAction', () => {
  const k = (o: Partial<Parameters<typeof rowKeyAction>[0]>) =>
    rowKeyAction({ key: 'Enter', isDragging: false, targetIsRow: true, mod: false, ...o });
  it('Enter trên dòng => mở; kèm Cmd/Ctrl => tab mới', () => {
    expect(k({})).toBe('open');
    expect(k({ mod: true })).toBe('open-new-tab');
  });
  it('Enter trên phần tử con (checkbox/nút) => không mở', () =>
    expect(k({ targetIsRow: false })).toBe('none'));
  it('Space => nhường dnd-kit nhấc dòng', () => expect(k({ key: ' ' })).toBe('dnd'));
  it('đang kéo bằng bàn phím => không can thiệp', () => {
    expect(k({ isDragging: true })).toBe('none');
    expect(k({ key: ' ', isDragging: true })).toBe('none');
  });
  it('phím khác => none', () => expect(k({ key: 'a' })).toBe('none'));
});

describe('peekSearch', () => {
  it('đặt/giữ tham số khác/xoá', () => {
    expect(peekSearch('', 'PSL-TASK-3')).toBe('?peek=PSL-TASK-3');
    expect(peekSearch('?q=a&peek=OLD', 'NEW-1')).toBe('?q=a&peek=NEW-1');
    expect(peekSearch('?q=a&peek=OLD', null)).toBe('?q=a');
    expect(peekSearch('?peek=OLD', null)).toBe('');
  });
});
