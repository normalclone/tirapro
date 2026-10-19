/** Phần tử điều hướng được bằng `j`/`k`: gắn `data-nav-item` (+ `data-issue-key` nếu là công việc) lên dòng/thẻ focus được. */
const NAV_ITEM_SELECTOR = '[data-nav-item]';

/**
 * Chỉ số phần tử kế tiếp khi bấm `j` (dir = 1) / `k` (dir = -1), KẸP trong [0, count-1] (không vòng).
 * `current < 0` (chưa focus phần tử nào): `j` → đầu, `k` → cuối. Danh sách rỗng → -1.
 */
export function nextNavIndex(count: number, current: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, current + dir));
}

/**
 * Vị trí hiện tại để tính `j`/`k`: dòng đang focus; nếu focus không nằm trên dòng nào (vd trong panel xem nhanh) thì dòng
 * đang xem nhanh (`peekKey`); không có cả hai → -1. `keys` = `data-issue-key` của từng phần tử điều hướng theo thứ tự DOM.
 */
export function navCurrentIndex(
  keys: readonly (string | null)[],
  focusedIdx: number,
  peekKey: string | null,
): number {
  if (focusedIdx >= 0) return focusedIdx;
  return peekKey ? keys.indexOf(peekKey) : -1;
}

/**
 * Mã công việc của phần tử điều hướng: `data-issue-key` trên chính nó hoặc tổ tiên gần nhất (vd dòng Việc mới vào là
 * `<li data-issue-key><div data-nav-item>`).
 */
export function issueKeyOf(el: Element): string | null {
  return el.closest('[data-issue-key]')?.getAttribute('data-issue-key') ?? null;
}

/** Phần tử có đang hiển thị không (loại phần tử nằm trong khu đã thu gọn / `display:none`). */
function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

/**
 * Dời focus tới phần tử điều hướng kế (theo thứ tự DOM, bỏ phần tử ẩn) rồi cuộn vừa đủ để thấy.
 * Panel xem nhanh đang mở (`peekKey`): đi từ dòng đang xem (kể cả khi focus nằm trong panel) và gọi `onPeek` để xem nhanh
 * dòng mới — MỘT hành vi nhất quán (như Jira): panel luôn theo dòng đang chọn. Trả `true` nếu đã dời.
 */
export function moveNavFocus(
  dir: 1 | -1,
  opts: { peekKey?: string | null; onPeek?: (key: string) => void } = {},
  root: ParentNode = document,
): boolean {
  const items = Array.from(root.querySelectorAll<HTMLElement>(NAV_ITEM_SELECTOR)).filter(isVisible);
  const active = document.activeElement;
  const focusedIdx = items.findIndex((el) => el === active || el.contains(active));
  const current = navCurrentIndex(items.map(issueKeyOf), focusedIdx, opts.peekKey ?? null);
  const target = items[nextNavIndex(items.length, current, dir)];
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest' });
  const key = issueKeyOf(target);
  if (opts.peekKey && key && key !== opts.peekKey) opts.onPeek?.(key);
  return true;
}
