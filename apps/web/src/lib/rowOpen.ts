import { PEEK_PARAM } from '@/features/issues/peek/peekParam';

interface ClickLike {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}

/** Click có phím bổ trợ hoặc không phải chuột trái → để trình duyệt xử lý (mở tab mới…). */
export const isModifiedClick = (e: ClickLike): boolean =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;

/** Trên DÒNG/THẺ: Cmd/Ctrl+click hoặc chuột giữa = mở trang đầy đủ ở tab mới (Shift/Alt không đổi nghĩa). */
export const wantsNewTab = (e: Pick<ClickLike, 'metaKey' | 'ctrlKey' | 'button'>): boolean =>
  e.metaKey || e.ctrlKey || e.button === 1;

const INTERACTIVE = 'a,button,input,select,textarea,label,[role="menuitem"],[data-no-peek]';

/**
 * Click rơi vào phần tử tương tác BÊN TRONG dòng (nút, link, ô nhập, hoặc đánh dấu `data-no-peek`) → dòng không mở.
 * Đi ngược tới `root` (không tính root: root là dòng, có role=button của dnd-kit).
 * Lưu ý: sự kiện từ portal (Radix Popover) nổi lên dòng theo cây React; nơi gọi phải kiểm thêm
 * `e.currentTarget.contains(e.target as Node)`.
 */
export function clickIsOnInteractive(target: EventTarget | null, root: Element | null): boolean {
  let el = target as (Element & { parentElement: Element | null }) | null;
  while (el && el !== root) {
    if (typeof el.matches === 'function' && el.matches(INTERACTIVE)) return true;
    el = el.parentElement;
  }
  return false;
}

export function rowKeyAction(e: {
  key: string;
  isDragging: boolean;
  targetIsRow: boolean;
  mod: boolean;
}): 'open' | 'open-new-tab' | 'dnd' | 'none' {
  if (e.isDragging || !e.targetIsRow) return 'none';
  if (e.key === 'Enter') return e.mod ? 'open-new-tab' : 'open';
  if (e.key === ' ') return 'dnd';
  return 'none';
}

/** Chuỗi `?…` mới sau khi đặt (`key`) hoặc xoá (`null`) tham số peek, giữ nguyên các tham số khác. */
export function peekSearch(search: string, key: string | null): string {
  const p = new URLSearchParams(search);
  if (key) p.set(PEEK_PARAM, key);
  else p.delete(PEEK_PARAM);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Thuộc tính bổ sung cho gốc dòng tuỳ khả năng kéo/mở (phần dnd-kit đã có tabIndex/role qua `attributes`).
 * Dòng không kéo được nhưng mở được là nút KÍCH HOẠT ĐƯỢC → không `aria-disabled` (trình đọc màn hình sẽ báo "không khả dụng");
 * `aria-roledescription` thay cho "dòng việc có thể kéo" của dnd-kit để nói rõ đây là dòng chỉ xem/mở.
 */
export function rowRootProps(o: { draggable: boolean; hasOpen: boolean }): Record<string, unknown> {
  if (o.draggable) return {};
  return o.hasOpen
    ? { tabIndex: 0, role: 'button', 'aria-roledescription': 'dòng việc' }
    : { 'aria-disabled': true };
}

/** Mở trang đầy đủ của công việc ở tab mới (một nơi cho mọi dòng/thẻ). */
export function openIssueInNewTab(key: string): void {
  window.open(`/issue/${key}`, '_blank', 'noopener');
}

interface RowClickEvent extends ClickLike {
  currentTarget: Element;
  target: EventTarget | null;
}

/**
 * Xử lý click/auxclick trên một dòng/thẻ: bỏ qua sự kiện từ portal (popover…) hoặc từ phần tử tương tác bên trong
 * (nút, link, ô nhập — chúng tự xử lý); Cmd/Ctrl/chuột giữa → tab mới; còn lại → `open(key)` (xem nhanh).
 * Trả về true nếu đã xử lý.
 */
export function openOnClick(e: RowClickEvent, key: string, open: (key: string) => void): boolean {
  if (
    !e.currentTarget.contains(e.target as Node) ||
    clickIsOnInteractive(e.target, e.currentTarget)
  )
    return false;
  if (wantsNewTab(e)) openIssueInNewTab(key);
  else open(key);
  return true;
}

interface RowKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  preventDefault: () => void;
}

/** Enter trên dòng = xem nhanh, Cmd/Ctrl+Enter = tab mới (xem `rowKeyAction`). Trả về true nếu đã xử lý (đã preventDefault). */
export function openOnRowKey(
  e: RowKeyEvent,
  o: { key: string; open?: (key: string) => void; isDragging?: boolean },
): boolean {
  const act = rowKeyAction({
    key: e.key,
    isDragging: !!o.isDragging,
    targetIsRow: e.target === e.currentTarget,
    mod: e.metaKey || e.ctrlKey,
  });
  if (act === 'open' && o.open) {
    e.preventDefault();
    o.open(o.key);
    return true;
  }
  if (act === 'open-new-tab') {
    e.preventDefault();
    openIssueInNewTab(o.key);
    return true;
  }
  return false;
}
