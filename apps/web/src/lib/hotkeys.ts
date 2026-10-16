type QueryRoot = Pick<Document, 'querySelector'>;

/** Kiểu <input> nhận chữ — phần còn lại (checkbox, radio, range, button, file, color…) không phải đang gõ. */
const TYPING_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

/** Có đang gõ trong ô nhập / vùng soạn thảo không → bỏ qua hotkey. */
export function isTypingTarget(el: EventTarget | null): boolean {
  // Kiểm cấu trúc (không `instanceof HTMLElement`) để test thuần được với phần tử giả.
  const node = el as Partial<HTMLElement> | null;
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName;
  // Chỉ ô nhập CHỮ/SỐ/NGÀY mới là "đang gõ": checkbox/radio/range/button (focus sau khi bấm) không được chặn phím tắt.
  if (tag === 'INPUT') {
    const type = ((node as Partial<HTMLInputElement>).type ?? 'text').toLowerCase();
    return TYPING_INPUT_TYPES.has(type);
  }
  return (
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    !!node.isContentEditable ||
    !!node.closest?.('[contenteditable="true"]')
  );
}

/**
 * Có dialog/modal nào đang MỞ không → bỏ qua hotkey. Radix gắn `role="dialog"` cả khi đang chạy
 * hiệu ứng đóng (`data-state="closed"`, DOM chưa gỡ) nên phải kiểm `open`.
 */
export function isDialogOpen(root: QueryRoot = document): boolean {
  return !!root.querySelector('[role="dialog"][data-state="open"]');
}

/**
 * Có lớp phủ nào đang mở không: dialog/alertdialog đang mở HOẶC menu/listbox/popover Radix (dropdown, select…).
 * Dùng cho hotkey một phím — trong menu đang mở, phím chữ là typeahead chứ không phải lệnh.
 * Dialog đã đóng (`data-state="closed"`, đang chạy hiệu ứng) không chặn.
 */
export function isOverlayOpen(root: QueryRoot = document): boolean {
  // Tour hướng dẫn (driver.js) không có role=dialog: coi là lớp phủ để c/e/a/j không chạy đè lên tour.
  if (typeof document !== 'undefined' && document.body?.classList.contains('driver-active'))
    return true;
  return !!root.querySelector(
    [
      '[role="dialog"][data-state="open"]',
      '[role="alertdialog"][data-state="open"]',
      '[role="menu"][data-state="open"]',
      '[role="listbox"][data-state="open"]',
      '[data-radix-popper-content-wrapper]',
    ].join(','),
  );
}

/**
 * Phím danh sách `j/k/a/e` có phải bỏ qua không (ngoài điều kiện chung của `shouldIgnoreGlobalHotkey`): đang nhấc thẻ bằng
 * Space (phím thuộc về dnd-kit), hoặc `e` ở trang công việc (trang tự xử lý sửa tiêu đề).
 */
export function shouldSkipListHotkey(
  key: string,
  ctx: { dragging: boolean; onIssuePage: boolean },
): boolean {
  if (ctx.dragging) return true;
  return key.toLowerCase() === 'e' && ctx.onIssuePage;
}

/** Phím `w` (không modifier) mở form ghi thời gian — chỉ khi có quyền, không đang gõ, không có dialog mở. */
export function isWorklogHotkey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  ctx: { typing: boolean; dialogOpen: boolean; canLog: boolean },
): boolean {
  if (!ctx.canLog || ctx.typing || ctx.dialogOpen) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key === 'w' || e.key === 'W';
}

/** Phím `m` (không modifier) viết bình luận — chỉ khi có quyền bình luận, không đang gõ, không có dialog mở. */
export function isCommentHotkey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  ctx: { typing: boolean; dialogOpen: boolean; canComment: boolean },
): boolean {
  if (!ctx.canComment || ctx.typing || ctx.dialogOpen) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key === 'm' || e.key === 'M';
}

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
}

/**
 * Phím tắt TOÀN CỤC (`c`, `g _`, `/`, `?`) có phải bỏ qua không: có modifier (⌘K, copy…), đang gõ, hoặc có lớp phủ mở —
 * kể cả menu/listbox/popover (không chỉ dialog): trong menu đang mở phím chữ là typeahead, không được cướp.
 */
export function shouldIgnoreGlobalHotkey(
  e: Pick<KeyLike, 'metaKey' | 'ctrlKey' | 'altKey'>,
  ctx: { typing: boolean; overlayOpen: boolean },
): boolean {
  return e.metaKey || e.ctrlKey || e.altKey || ctx.typing || ctx.overlayOpen;
}

/**
 * Esc có nên xoá vùng chọn hàng loạt không: không nếu Esc đã được xử lý (popover/kéo-thả bằng phím) hoặc lớp phủ đang mở.
 * `fromPeek`: Esc đến từ trong panel xem nhanh → dành cho việc đóng panel, không bỏ chọn.
 * `dragging`: đang kéo (dnd-kit active) → Esc chỉ huỷ kéo. Cần vì thanh chọn nghe ở `document`, chạy TRƯỚC listener dnd-kit
 * nên chưa thấy `defaultPrevented` của nó.
 */
export function shouldClearSelectionOnEscape(
  e: Pick<KeyLike, 'key' | 'defaultPrevented'>,
  overlayOpen: boolean,
  opts?: { fromPeek?: boolean; dragging?: boolean },
): boolean {
  if (opts?.fromPeek || opts?.dragging) return false;
  return e.key === 'Escape' && !e.defaultPrevented && !overlayOpen;
}

/**
 * Esc có nên đóng panel xem nhanh không: không nếu lớp phủ đang mở, Esc đã có người xử lý (bỏ chọn hàng loạt, huỷ sửa tại chỗ),
 * hoặc Esc đến từ một ô nhập đang có chữ chưa gửi (`draftFocused`) — lần Esc đó chỉ rời ô (giữ nháp), Esc sau mới đóng.
 */
export function shouldClosePeekOnEscape(
  e: Pick<KeyLike, 'key' | 'defaultPrevented'>,
  ctx: { overlayOpen: boolean; draftFocused?: boolean; dragging?: boolean },
): boolean {
  return (
    e.key === 'Escape' &&
    !e.defaultPrevented &&
    !ctx.overlayOpen &&
    !ctx.draftFocused &&
    !ctx.dragging
  );
}

/**
 * Esc có nên thoát chế độ soạn dashboard không: không nếu Esc đã có người xử lý (`defaultPrevented` — Radix đóng hộp/popover,
 * dnd-kit huỷ kéo bằng phím; React flush state của chúng trước listener `window` nên `overlayOpen`/`dragging` có thể đã
 * thành false rồi), đang gõ, đang kéo hoặc có lớp phủ mở.
 */
export function shouldLeaveEditorOnEscape(
  e: Pick<KeyLike, 'key' | 'defaultPrevented'>,
  ctx: { typing: boolean; overlayOpen: boolean; dragging: boolean },
): boolean {
  return (
    e.key === 'Escape' && !e.defaultPrevented && !ctx.typing && !ctx.overlayOpen && !ctx.dragging
  );
}

/** Phần tử nhập liệu đang chứa chữ (ô input/textarea có giá trị, hoặc contenteditable có nội dung) — tức có nháp chưa gửi. */
export function hasDraftText(
  t: {
    tagName?: string;
    value?: string;
    isContentEditable?: boolean;
    textContent?: string | null;
  } | null,
): boolean {
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return (t.value ?? '').trim() !== '';
  if (t.isContentEditable) return (t.textContent ?? '').trim() !== '';
  return false;
}
