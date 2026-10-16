/** Tiến độ thời gian: `pct = null` khi chưa có ước lượng gốc hợp lệ (không suy ra 100% từ giờ đã làm). */
export function timeProgress(
  spent: number,
  original: number | null | undefined,
): { pct: number | null; over: boolean } {
  if (!original || original <= 0) return { pct: null, over: false };
  return { pct: Math.min(100, Math.round((spent / original) * 100)), over: spent > original };
}

/**
 * "Còn lại" hiển thị: dùng ước lượng còn lại đã lưu; chưa có mà có ước lượng gốc → `max(0, gốc − đã ghi)` và đánh dấu
 * `estimated` (UI ghi nhỏ "ước tính") thay vì "—". Không có cả hai → `seconds = null`.
 */
export function displayRemaining(
  spent: number,
  original: number | null | undefined,
  remaining: number | null | undefined,
): { seconds: number | null; estimated: boolean } {
  if (remaining != null) return { seconds: remaining, estimated: false };
  if (original && original > 0) return { seconds: Math.max(0, original - spent), estimated: true };
  return { seconds: null, estimated: false };
}
