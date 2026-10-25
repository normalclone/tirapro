/**
 * Chọn hành động cho phím Cmd/Ctrl+Enter trong hộp thoại/ô soạn:
 * - Cmd/Ctrl+Enter → `onSubmit`;
 * - Cmd/Ctrl+Shift+Enter → `onSubmitAlt` nếu có, KHÔNG rơi về `onSubmit` (hành động chính khác hẳn hành động phụ);
 *   không có `onSubmitAlt` thì Shift giữ hành vi cũ (gửi như Cmd/Ctrl+Enter) để các hộp thoại khác không đổi.
 * Trả `null` nếu phím không phải tổ hợp gửi hoặc không có hành động tương ứng.
 */
export function pickSubmit(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  h: { onSubmit?: () => void; onSubmitAlt?: () => void },
): (() => void) | null {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return null;
  if (e.shiftKey && h.onSubmitAlt) return h.onSubmitAlt;
  return h.onSubmit ?? null;
}

/** Nhãn hiển thị + `aria-keyshortcuts` của hai tổ hợp (dùng chung để chữ phím không rải ra nhiều nơi). */
export const SUBMIT_SHORTCUT = { label: '⌘/Ctrl+Enter', keys: 'Meta+Enter Control+Enter' } as const;
export const SUBMIT_ALT_SHORTCUT = {
  label: '⌘/Ctrl+Shift+Enter',
  keys: 'Meta+Shift+Enter Control+Shift+Enter',
} as const;
