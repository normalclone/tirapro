/** Tiến độ thời gian: `pct = null` khi chưa có ước lượng gốc hợp lệ (không suy ra 100% từ giờ đã làm). */
export function timeProgress(
  spent: number,
  original: number | null | undefined,
): { pct: number | null; over: boolean } {
  if (!original || original <= 0) return { pct: null, over: false };
  return { pct: Math.min(100, Math.round((spent / original) * 100)), over: spent > original };
}
