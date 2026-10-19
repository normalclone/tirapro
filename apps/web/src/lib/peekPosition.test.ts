import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveNavFocus, navCurrentIndex, nextNavIndex, readNavKeys, stepKey } from './listNav';
import {
  concatKeys,
  peekAriaLabel,
  peekCountText,
  peekPosition,
  peekedKeyIn,
  resolvePendingMore,
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
      more: false,
      needsLoadMore: false,
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

describe('peekPosition — danh sách có phân trang (còn kết quả ngoài phần đã nạp)', () => {
  const paged = (canLoadMore: boolean) => ({ more: true, canLoadMore });
  it('"3/50+": nhãn thêm dấu + và nhãn truy cập nói "ít nhất"', () => {
    const p = peekPosition(keys, 'A-2', false, paged(true))!;
    expect(p).toMatchObject({ more: true, countKnown: true });
    expect(peekCountText(p)).toBe('2/4+');
    expect(peekAriaLabel(p)).toBe('Việc 2 trên ít nhất 4');
  });
  it('hết dòng đã nạp + còn trang + có loadMore → "Việc sau" vẫn bật và báo cần nạp thêm', () => {
    const p = peekPosition(keys, 'A-4', false, paged(true))!;
    expect(p).toMatchObject({ hasNext: true, needsLoadMore: true });
  });
  it('hết dòng đã nạp + còn trang nhưng KHÔNG có loadMore → vô hiệu như cuối danh sách', () => {
    expect(peekPosition(keys, 'A-4', false, paged(false))).toMatchObject({
      hasNext: false,
      needsLoadMore: false,
      more: true,
    });
  });
  it('giữa danh sách: không cần nạp thêm; danh sách đủ (more=false): nhãn không có dấu +', () => {
    expect(peekPosition(keys, 'A-2', false, paged(true))!.needsLoadMore).toBe(false);
    const full = peekPosition(keys, 'A-4', false, { more: false, canLoadMore: true })!;
    expect(full).toMatchObject({ hasNext: false, more: false });
    expect(peekCountText(full)).toBe('4/4');
  });
});

describe('stepKey — khoá kế tiếp theo thứ tự thật (nguồn chung của j/k và ‹ ›)', () => {
  it('đi tiếp/lùi, kẹp ở hai đầu (trả chính khoá đó)', () => {
    expect(stepKey(keys, 'A-2', 1)).toBe('A-3');
    expect(stepKey(keys, 'A-2', -1)).toBe('A-1');
    expect(stepKey(keys, 'A-4', 1)).toBe('A-4');
    expect(stepKey(keys, 'A-1', -1)).toBe('A-1');
  });
  it('chưa có/không thấy khoá hiện tại: j → đầu, k → cuối; danh sách rỗng → null', () => {
    expect(stepKey(keys, null, 1)).toBe('A-1');
    expect(stepKey(keys, 'Z-9', -1)).toBe('A-4');
    expect(stepKey([], 'A-1', 1)).toBeNull();
  });
  it('khớp nút: hasNext/hasPrev của peekPosition ⇔ stepKey đổi khoá', () => {
    for (const k of keys) {
      const p = peekPosition(keys, k)!;
      expect(stepKey(keys, k, 1) !== k).toBe(p.hasNext);
      expect(stepKey(keys, k, -1) !== k).toBe(p.hasPrev);
    }
  });
});

describe('moveNavFocus với thứ tự thật (order) — j/k và ‹ › cùng một đường', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('hàng đích có trong DOM: focus + cuộn + gọi onPeek; không gọi reveal', () => {
    vi.stubGlobal('document', { activeElement: null });
    const items = [fakeItem('A-1'), fakeItem('A-2'), fakeItem('A-3')];
    const opened: string[] = [];
    const revealed: string[] = [];
    moveNavFocus(
      1,
      {
        peekKey: 'A-1',
        onPeek: (k) => opened.push(k),
        order: { keys: ['A-1', 'A-2', 'A-3'], reveal: (k) => revealed.push(k) },
      },
      fakeRoot(items),
    );
    expect(opened).toEqual(['A-2']);
    expect(revealed).toEqual([]);
    expect(items[1]!.calls[0]).toBe('focus');
  });
  it('hàng đích CHƯA vẽ (ảo hoá/trang khác): bước qua nó theo order, gọi reveal(key) và onPeek(key)', () => {
    vi.stubGlobal('document', { activeElement: null });
    const items = [fakeItem('A-1')]; // chỉ A-1 trong DOM; A-2, A-3 chưa vẽ
    const opened: string[] = [];
    const revealed: string[] = [];
    const moved = moveNavFocus(
      1,
      {
        peekKey: 'A-1',
        onPeek: (k) => opened.push(k),
        fromPeek: true,
        focus: false,
        order: { keys: ['A-1', 'A-2', 'A-3'], reveal: (k) => revealed.push(k) },
      },
      fakeRoot(items),
    );
    expect(moved).toBe(true);
    expect(revealed).toEqual(['A-2']);
    expect(opened).toEqual(['A-2']);
  });
  it('cuối order: không dời, không onPeek (kẹp, không vòng)', () => {
    vi.stubGlobal('document', { activeElement: null });
    const opened: string[] = [];
    moveNavFocus(
      1,
      {
        peekKey: 'A-3',
        onPeek: (k) => opened.push(k),
        fromPeek: true,
        focus: false,
        order: { keys: ['A-1', 'A-2', 'A-3'] },
      },
      fakeRoot([fakeItem('A-3')]),
    );
    expect(opened).toEqual([]);
  });
  it('TƯƠNG ĐƯƠNG: phím j (focus ở dòng đang xem) và nút › (fromPeek) cho cùng khoá kế tiếp ở mọi vị trí', () => {
    const order = { keys: ['A-1', 'A-2', 'A-3', 'A-4'] };
    for (const dir of [1, -1] as const) {
      for (const cur of order.keys) {
        const run = (fromPeek: boolean) => {
          const items = order.keys.map((k) => fakeItem(k));
          const focused = items[order.keys.indexOf(cur)]!;
          vi.stubGlobal('document', { activeElement: focused });
          const opened: string[] = [];
          moveNavFocus(
            dir,
            {
              peekKey: cur,
              onPeek: (k) => opened.push(k),
              order,
              fromPeek,
              focus: fromPeek ? false : undefined,
            },
            fakeRoot(items),
          );
          return opened;
        };
        expect(run(false)).toEqual(run(true));
      }
    }
  });
});

describe('concatKeys — thứ tự thật của trang nhiều khu (sprint… rồi Việc chờ… rồi sprint đã đóng)', () => {
  it('nối khoá các khu theo thứ tự hiển thị, giữ thứ tự trong khu', () => {
    expect(concatKeys([[{ key: 'S-1' }, { key: 'S-2' }], [], [{ key: 'B-1' }]])).toEqual([
      'S-1',
      'S-2',
      'B-1',
    ]);
  });
  it('trùng khoá (một việc không thể ở hai khu) chỉ giữ lần đầu', () => {
    expect(concatKeys([[{ key: 'A' }], [{ key: 'A' }, { key: 'B' }]])).toEqual(['A', 'B']);
  });
});

describe('resolvePendingMore — tự bước sau khi "Việc sau" nạp thêm', () => {
  const ks = ['A-1', 'A-2', 'A-3'];
  const r = (pending: string | null, peekKey: string, keys: readonly string[], loading: boolean) =>
    resolvePendingMore(pending, { peekKey, keys, loading });
  it('không chờ gì → không làm gì (nạp thủ công "Tải thêm" KHÔNG tự bước)', () => {
    expect(r(null, 'A-3', [...ks, 'A-4'], false)).toEqual({ action: 'none' });
  });
  it('đang nạp, chưa có dòng mới → chờ', () => {
    expect(r('A-3', 'A-3', ks, true)).toEqual({ action: 'wait' });
  });
  it('có dòng mới sau việc đang xem → bước sang dòng đầu của phần mới', () => {
    expect(r('A-3', 'A-3', [...ks, 'A-4', 'A-5'], false)).toEqual({ action: 'step', next: 'A-4' });
  });
  it('nạp xong mà không thêm dòng nào (lỗi/rỗng) → huỷ chờ, để nạp thủ công sau đó không tự bước', () => {
    expect(r('A-3', 'A-3', ks, false)).toEqual({ action: 'cancel' });
  });
  it('đã sang việc khác (hoặc việc đang xem không còn trong danh sách) → huỷ', () => {
    expect(r('A-3', 'A-2', ks, true)).toEqual({ action: 'cancel' });
    expect(r('A-3', 'A-3', ['B-1'], true)).toEqual({ action: 'cancel' });
  });
});
