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
): PeekPosition | null {
  if (!peekKey) return null;
  const i = keys.indexOf(peekKey);
  if (i < 0) return null;
  return {
    number: i + 1,
    total: keys.length,
    hasPrev: nextNavIndex(keys.length, i, -1) !== i,
    hasNext: nextNavIndex(keys.length, i, 1) !== i,
    countKnown: !partial,
  };
}

/** "3/25" — hiển thị. */
export const peekCountText = (p: PeekPosition): string => `${p.number}/${p.total}`;
/** "Việc 3 trên 25" — tên truy cập cho trình đọc màn hình. */
export const peekAriaLabel = (p: PeekPosition): string => `Việc ${p.number} trên ${p.total}`;

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
