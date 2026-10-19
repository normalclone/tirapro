import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveNavFocus, navCurrentIndex, nextNavIndex, readNavKeys } from './listNav';
import {
  peekAriaLabel,
  peekCountText,
  peekPosition,
  peekedKeyIn,
  sameNavSnapshot,
} from './peekPosition';

const keys = ['A-1', 'A-2', 'A-3', 'A-4'];

describe('peekPosition — vị trí việc đang xem trong thứ tự danh sách', () => {
  it('giữa danh sách: số thứ tự 1-based, tổng, có cả trước lẫn sau', () => {
    expect(peekPosition(keys, 'A-2')).toEqual({
      number: 2,
      total: 4,
      hasPrev: true,
      hasNext: true,
      countKnown: true,
    });
  });
  it('đầu danh sách: không có việc trước; cuối danh sách: không có việc sau (kẹp, KHÔNG vòng — như j/k)', () => {
    expect(peekPosition(keys, 'A-1')).toMatchObject({ number: 1, hasPrev: false, hasNext: true });
    expect(peekPosition(keys, 'A-4')).toMatchObject({ number: 4, hasPrev: true, hasNext: false });
  });
  it('chỉ một việc: cả hai nút đều vô hiệu', () => {
    expect(peekPosition(['A-1'], 'A-1')).toMatchObject({
      total: 1,
      hasPrev: false,
      hasNext: false,
    });
  });
  it('thứ tự không biết (không có peek, việc không nằm trong danh sách, danh sách rỗng) → null (ẩn hẳn nút và n/N)', () => {
    expect(peekPosition(keys, null)).toBeNull();
    expect(peekPosition(keys, 'A-9')).toBeNull();
    expect(peekPosition([], 'A-1')).toBeNull();
  });
  it('danh sách ảo hoá một phần (DOM chỉ có cửa sổ): vẫn bước được nhưng KHÔNG khẳng định n/N (countKnown=false)', () => {
    expect(peekPosition(keys, 'A-2', true)).toMatchObject({
      hasPrev: true,
      hasNext: true,
      countKnown: false,
    });
  });
  it('khớp đúng với j/k: nút sau/trước đi tới đúng chỉ số mà nextNavIndex sẽ chọn', () => {
    for (const k of keys) {
      const cur = navCurrentIndex(keys, -1, k);
      const pos = peekPosition(keys, k)!;
      expect(nextNavIndex(keys.length, cur, 1) !== cur).toBe(pos.hasNext);
      expect(nextNavIndex(keys.length, cur, -1) !== cur).toBe(pos.hasPrev);
    }
  });
});

describe('nhãn', () => {
  const pos = peekPosition(keys, 'A-3')!;
  it('văn bản "3/4" và nhãn truy cập "Việc 3 trên 4"', () => {
    expect(peekCountText(pos)).toBe('3/4');
    expect(peekAriaLabel(pos)).toBe('Việc 3 trên 4');
  });
});

describe('sameNavSnapshot', () => {
  it('so theo giá trị (cùng khoá cùng thứ tự + cùng cờ partial)', () => {
    expect(
      sameNavSnapshot({ keys: ['a', 'b'], partial: false }, { keys: ['a', 'b'], partial: false }),
    ).toBe(true);
    expect(
      sameNavSnapshot({ keys: ['a', 'b'], partial: false }, { keys: ['b', 'a'], partial: false }),
    ).toBe(false);
    expect(
      sameNavSnapshot({ keys: ['a'], partial: false }, { keys: ['a', 'b'], partial: false }),
    ).toBe(false);
    expect(sameNavSnapshot({ keys: ['a'], partial: false }, { keys: ['a'], partial: true })).toBe(
      false,
    );
  });
});

describe('peekedKeyIn — chỉ cột/khu CÓ việc đang xem nhận khoá (memo không vẽ lại cột khác)', () => {
  const issues = [{ key: 'A-1' }, { key: 'A-2' }];
  it('có → khoá; không có hoặc không peek → null', () => {
    expect(peekedKeyIn(issues, 'A-2')).toBe('A-2');
    expect(peekedKeyIn(issues, 'B-1')).toBeNull();
    expect(peekedKeyIn(issues, null)).toBeNull();
  });
});

// DOM giả đủ dùng cho readNavKeys / moveNavFocus (vitest chạy node, không jsdom).
function fakeItem(key: string, visible = true) {
  const calls: string[] = [];
  const el = {
    offsetParent: visible ? {} : null,
    getClientRects: () => (visible ? [{}] : []),
    contains: () => false,
    focus: () => calls.push('focus'),
    scrollIntoView: (o: unknown) => calls.push(`scroll:${JSON.stringify(o)}`),
    closest: () => ({ getAttribute: () => key }),
    calls,
  };
  return el;
}
function fakeRoot(items: ReturnType<typeof fakeItem>[], partial = false) {
  return {
    querySelectorAll: () => items,
    querySelector: (s: string) => (s === '[data-nav-partial]' && partial ? {} : null),
  } as unknown as ParentNode;
}

describe('readNavKeys', () => {
  it('khoá theo thứ tự DOM, bỏ phần tử ẩn; partial khi có danh sách ảo hoá thiếu dòng', () => {
    const root = fakeRoot([fakeItem('A-1'), fakeItem('A-2', false), fakeItem('A-3')]);
    expect(readNavKeys(root)).toEqual({ keys: ['A-1', 'A-3'], partial: false });
    expect(readNavKeys(fakeRoot([fakeItem('A-1')], true)).partial).toBe(true);
  });
});

describe('moveNavFocus — dùng chung cho j/k và nút ‹ ›', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('nút (fromPeek + focus:false): đi từ dòng đang xem, KHÔNG cướp focus, vẫn cuộn nearest và gọi onPeek', () => {
    const items = [fakeItem('A-1'), fakeItem('A-2'), fakeItem('A-3')];
    const opened: string[] = [];
    const moved = moveNavFocus(
      1,
      { peekKey: 'A-2', onPeek: (k) => opened.push(k), fromPeek: true, focus: false },
      fakeRoot(items),
    );
    expect(moved).toBe(true);
    expect(opened).toEqual(['A-3']);
    expect(items[2]!.calls).toEqual(['scroll:{"block":"nearest"}']);
  });
  it('j/k mặc định vẫn dời focus tới dòng đích', () => {
    vi.stubGlobal('document', { activeElement: null });
    const items = [fakeItem('A-1'), fakeItem('A-2')];
    const opened: string[] = [];
    moveNavFocus(-1, { peekKey: 'A-2', onPeek: (k) => opened.push(k) }, fakeRoot(items));
    expect(opened).toEqual(['A-1']);
    expect(items[0]!.calls[0]).toBe('focus');
  });
  it('ở cuối: không dời, không gọi onPeek (kẹp như j/k)', () => {
    const items = [fakeItem('A-1'), fakeItem('A-2')];
    const opened: string[] = [];
    moveNavFocus(
      1,
      { peekKey: 'A-2', onPeek: (k) => opened.push(k), fromPeek: true, focus: false },
      fakeRoot(items),
    );
    expect(opened).toEqual([]);
  });
});
