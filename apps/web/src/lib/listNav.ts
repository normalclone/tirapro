/** Phần tử điều hướng được bằng `j`/`k`: gắn `data-nav-item` (+ `data-issue-key` nếu là công việc) lên dòng/thẻ focus được. */
export const NAV_ITEM_SELECTOR = '[data-nav-item]';

/**
 * Chỉ số phần tử kế tiếp khi bấm `j` (dir = 1) / `k` (dir = -1), KẸP trong [0, count-1] (không vòng).
 * `current < 0` (chưa focus phần tử nào): `j` → đầu, `k` → cuối. Danh sách rỗng → -1.
 */
export function nextNavIndex(count: number, current: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, current + dir));
}

/** Phần tử có đang hiển thị không (loại phần tử nằm trong khu đã thu gọn / `display:none`). */
function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

/** Dời focus tới phần tử điều hướng kế (theo thứ tự DOM, bỏ phần tử ẩn) rồi cuộn vừa đủ để thấy. Trả `true` nếu đã dời. */
export function moveNavFocus(dir: 1 | -1, root: ParentNode = document): boolean {
  const items = Array.from(root.querySelectorAll<HTMLElement>(NAV_ITEM_SELECTOR)).filter(isVisible);
  const active = document.activeElement;
  const current = items.findIndex((el) => el === active || el.contains(active));
  const next = nextNavIndex(items.length, current, dir);
  const target = items[next];
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest' });
  return true;
}
