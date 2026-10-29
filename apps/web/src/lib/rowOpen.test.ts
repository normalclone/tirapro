import { describe, expect, it } from 'vitest';
import {
  clickIsOnInteractive,
  isModifiedClick,
  peekSearch,
  rowKeyAction,
  openOnClick,
  openOnRowKey,
  rowRootProps,
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
  it('Triage: bấm nút Nhận bên trong li không mở panel, bấm vùng trống thì mở', () => {
    const li = node('LI');
    const btn = node('BUTTON', node('DIV', li));
    expect(clickIsOnInteractive(btn as never, li as never)).toBe(true);
    expect(clickIsOnInteractive(node('SPAN', node('DIV', li)) as never, li as never)).toBe(false);
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

describe('rowRootProps', () => {
  it('dòng không kéo được vẫn focus được và mở được', () => {
    const p = rowRootProps({ draggable: false, hasOpen: true });
    expect(p).toMatchObject({ tabIndex: 0, role: 'button', 'aria-roledescription': 'dòng việc' });
    expect(p).not.toHaveProperty('aria-disabled'); // vẫn kích hoạt được → không báo "không khả dụng"
  });
  it('dòng kéo được: giữ thuộc tính dnd (không ghi đè tabIndex/role của dnd-kit)', () => {
    expect(rowRootProps({ draggable: true, hasOpen: true })).toEqual({});
  });
  it('không có onOpen: không thêm gì cho dòng không kéo', () => {
    expect(rowRootProps({ draggable: false, hasOpen: false })).toEqual({ 'aria-disabled': true });
  });
});

describe('openOnRowKey / openOnClick (logic mở dòng dùng chung)', () => {
  const opened: string[] = [];
  const open = (k: string) => opened.push(k);
  const row = {};
  const kev = (
    o: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; target: unknown }> = {},
  ) => {
    let prevented = false;
    return {
      e: {
        key: 'Enter',
        metaKey: false,
        ctrlKey: false,
        target: row,
        currentTarget: row,
        ...o,
        preventDefault: () => {
          prevented = true;
        },
      },
      prevented: () => prevented,
    };
  };
  it('Enter trên dòng → open + preventDefault; Enter trên phần tử con → không xử lý', () => {
    opened.length = 0;
    const a = kev();
    expect(openOnRowKey(a.e as never, { key: 'K-1', open })).toBe(true);
    expect(a.prevented()).toBe(true);
    expect(opened).toEqual(['K-1']);
    expect(openOnRowKey(kev({ target: {} }).e as never, { key: 'K-1', open })).toBe(false);
  });
  it('Space/đang kéo/không có open → không xử lý (nhường dnd-kit)', () => {
    expect(openOnRowKey(kev({ key: ' ' }).e as never, { key: 'K-1', open })).toBe(false);
    expect(openOnRowKey(kev().e as never, { key: 'K-1', open, isDragging: true })).toBe(false);
    expect(openOnRowKey(kev().e as never, { key: 'K-1' })).toBe(false);
  });
  it('Cmd/Ctrl+Enter → mở tab mới', () => {
    const calls: unknown[][] = [];
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = { open: (...a: unknown[]) => calls.push(a) };
    try {
      expect(openOnRowKey(kev({ metaKey: true }).e as never, { key: 'K-2', open })).toBe(true);
    } finally {
      g.window = prev;
    }
    expect(calls).toEqual([['/issue/K-2', '_blank', 'noopener']]);
  });
  it('openOnClick: bỏ qua nút bên trong và sự kiện ngoài dòng; click thường → open', () => {
    opened.length = 0;
    const root = { contains: () => true, matches: () => false, parentElement: null };
    const click = (target: unknown, contains = true) => ({
      currentTarget: { ...root, contains: () => contains },
      target,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      button: 0,
    });
    const btn = node('BUTTON', root);
    expect(openOnClick(click(btn) as never, 'K-3', open)).toBe(false);
    expect(openOnClick(click(root, false) as never, 'K-3', open)).toBe(false);
    expect(openOnClick(click(root) as never, 'K-3', open)).toBe(true);
    expect(opened).toEqual(['K-3']);
  });
});
