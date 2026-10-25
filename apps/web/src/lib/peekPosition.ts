import { nextNavIndex } from './listNav';

/** Ảnh chụp thứ tự điều hướng trong DOM (xem `readNavKeys`). */
export interface NavSnapshot {
  keys: readonly (string | null)[];
  /** Có danh sách ảo hoá đang thiếu dòng trong DOM → tổng/thứ tự "n/N" không đáng tin. */
  partial: boolean;
}

export interface PeekPosition {
  /** Thứ tự 1-based của việc đang xem trong danh sách đang hiển thị. */
  number: number;
  total: number;
  /** Có việc trước/sau để bước tới — kẹp ở hai đầu, KHÔNG vòng, đúng như `j`/`k` (`nextNavIndex`). */
  hasPrev: boolean;
  hasNext: boolean;
  /** false = DOM chỉ có một cửa sổ của danh sách ảo hoá: vẫn bước được nhưng không hiện "n/N". */
  countKnown: boolean;
  /** Danh sách phân trang còn kết quả ngoài phần đã nạp: nhãn "3/50+" (N là số đã nạp, không phải tổng). */
  more: boolean;
  /** Đang ở dòng cuối phần đã nạp, còn trang và trang có `loadMore` → "Việc sau" nạp thêm rồi bước. */
  needsLoadMore: boolean;
}

/** Trạng thái phân trang của danh sách (từ `PeekOrder`): còn nữa không, và trang có nạp thêm được không. */
export interface PeekPaging {
  more: boolean;
  canLoadMore: boolean;
}

/**
 * Vị trí của việc đang xem nhanh trong thứ tự danh sách (thứ tự DOM của `[data-nav-item]`, cùng nguồn với `j`/`k`).
 * `null` = thứ tự không biết (không có peek, hoặc việc không nằm trong danh sách đang hiển thị — vd mở từ chỗ không có danh
 * sách) → ẩn nút ‹ › lẫn "n/N" thay vì hiện nút vô hiệu.
 */
export function peekPosition(
  keys: readonly (string | null)[],
  peekKey: string | null,
  partial = false,
  paging?: PeekPaging,
): PeekPosition | null {
  if (!peekKey) return null;
  const i = keys.indexOf(peekKey);
  if (i < 0) return null;
  const more = !!paging?.more;
  const needsLoadMore = i === keys.length - 1 && more && !!paging?.canLoadMore;
  return {
    number: i + 1,
    total: keys.length,
    hasPrev: nextNavIndex(keys.length, i, -1) !== i,
    hasNext: nextNavIndex(keys.length, i, 1) !== i || needsLoadMore,
    countKnown: !partial,
    more,
    needsLoadMore,
  };
}

/** "3/25" (hoặc "3/50+" khi còn kết quả chưa nạp) — hiển thị. */
export const peekCountText = (p: PeekPosition): string =>
  `${p.number}/${p.total}${p.more ? '+' : ''}`;
/** "Việc 3 trên 25" ("Việc 3 trên ít nhất 50" khi còn nữa) — tên truy cập cho trình đọc màn hình. */
export const peekAriaLabel = (p: PeekPosition): string =>
  `Việc ${p.number} trên ${p.more ? 'ít nhất ' : ''}${p.total}`;

export function sameNavSnapshot(a: NavSnapshot, b: NavSnapshot): boolean {
  return (
    a.partial === b.partial &&
    a.keys.length === b.keys.length &&
    a.keys.every((k, i) => k === b.keys[i])
  );
}

/**
 * Khoá việc đang xem NẾU nó nằm trong `issues`, ngược lại null — để chỉ cột/khu chứa nó nhận prop `peekedKey` khác đi
 * (Column/Card là memo: đổi việc đang xem chỉ vẽ lại hai cột chứ không phải cả bảng).
 */
export function peekedKeyIn(
  issues: readonly { key: string }[],
  peekKey: string | null,
): string | null {
  return peekKey && issues.some((i) => i.key === peekKey) ? peekKey : null;
}

/** Nối khoá của các khu theo thứ tự hiển thị (bỏ trùng, giữ lần đầu) — thứ tự thật của trang có nhiều khu như Việc chờ. */
export function concatKeys(groups: readonly (readonly { key: string }[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups)
    for (const { key } of g)
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
  return out;
}

/**
 * Sau khi bấm "Việc sau" ở dòng cuối phần đã nạp (panel gọi `loadMore`): quyết định bước tiếp của lúc chờ.
 * `pending` = khoá việc đang xem lúc bấm (null = không chờ — nạp thủ công "Tải thêm" KHÔNG bao giờ tự bước).
 * - `step`: đã có dòng mới ngay sau việc đang xem → bước sang đó.
 * - `wait`: đang nạp, chưa có dòng mới.
 * - `cancel`: đã sang việc khác / việc không còn trong danh sách / nạp xong mà không thêm dòng nào (lỗi hoặc rỗng) → bỏ chờ.
 */
export function resolvePendingMore(
  pending: string | null,
  d: { peekKey: string; keys: readonly string[]; loading: boolean },
):
  | { action: 'none' }
  | { action: 'wait' }
  | { action: 'cancel' }
  | { action: 'step'; next: string } {
  if (pending === null) return { action: 'none' };
  const i = d.keys.indexOf(d.peekKey);
  if (pending !== d.peekKey || i < 0) return { action: 'cancel' };
  const next = d.keys[i + 1];
  if (next !== undefined) return { action: 'step', next };
  return d.loading ? { action: 'wait' } : { action: 'cancel' };
}
