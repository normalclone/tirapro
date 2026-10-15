/** Có đang gõ trong ô nhập / vùng soạn thảo không → bỏ qua hotkey. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    !!el.closest('[contenteditable="true"]')
  );
}

/**
 * Có dialog/modal nào đang MỞ không → bỏ qua hotkey. Radix gắn `role="dialog"` cả khi đang chạy
 * hiệu ứng đóng (`data-state="closed"`, DOM chưa gỡ) nên phải kiểm `open`.
 */
export function isDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"]');
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
