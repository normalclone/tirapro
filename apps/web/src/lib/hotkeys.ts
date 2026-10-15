type QueryRoot = Pick<Document, 'querySelector'>;

/** Có đang gõ trong ô nhập / vùng soạn thảo không → bỏ qua hotkey. */
export function isTypingTarget(el: EventTarget | null): boolean {
  // Kiểm cấu trúc (không `instanceof HTMLElement`) để test thuần được với phần tử giả.
  const node = el as Partial<HTMLElement> | null;
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName;
  return (
    tag === 'INPUT' ||
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

/** Phím `w` (không modifier) mở form ghi thời gian — chỉ khi có quyền, không đang gõ, không có dialog mở. */
export function isWorklogHotkey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  ctx: { typing: boolean; dialogOpen: boolean; canLog: boolean },
): boolean {
  if (!ctx.canLog || ctx.typing || ctx.dialogOpen) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key === 'w' || e.key === 'W';
}
