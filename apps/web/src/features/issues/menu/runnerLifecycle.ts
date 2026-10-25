/** Cửa sổ Hoàn tác của toast đổi trạng thái (xem `transitionToastOptions`): runner còn sống tới hết khoảng này. */
export const UNDO_WINDOW_MS = 8_000;
/** Chốt chặn: runner KHÔNG có hộp mở và KHÔNG có mutation đang chạy không được treo vô hạn. */
export const SAFETY_MS = 60_000;

export interface RunnerLifecycleInput {
  /** Hộp Cách giải quyết/lý do đang mở. */
  dialogOpen: boolean;
  /** Mutation đổi trạng thái đang chạy (kể cả Hoàn tác, thử lại sau lỗi). */
  isPending: boolean;
  /** Lần chạy gần nhất thành công / thất bại. */
  succeeded: boolean;
  failed: boolean;
  /** Hộp đã từng mở trong đời runner này. */
  dialogSeen: boolean;
}

/**
 * Quyết định hẹn giờ gỡ runner đổi trạng thái: `'keep'` = không hẹn (huỷ hẹn cũ), `{ removeAfterMs }` = gỡ sau chừng đó.
 * Hộp đang mở hoặc đang chạy mutation thì KHÔNG bao giờ hẹn gỡ — kẻo hộp (cùng chữ đã gõ) biến mất sau chốt chặn hay sau
 * một lần xác nhận lỗi. Chỉ sau thành công với hộp đã đóng mới giữ cửa sổ Hoàn tác; hộp bị huỷ / lỗi khi chuyển thẳng gỡ ngay.
 */
export function runnerLifecycle(s: RunnerLifecycleInput): 'keep' | { removeAfterMs: number } {
  if (s.dialogOpen || s.isPending) return 'keep';
  if (s.succeeded) return { removeAfterMs: UNDO_WINDOW_MS };
  if (s.failed || s.dialogSeen) return { removeAfterMs: 0 };
  return { removeAfterMs: SAFETY_MS };
}
