/**
 * Giá trị Hiện tại của kết quả then chốt không được vượt Cần đạt (logbug #30). Chỉ áp cho KR TĂNG dần
 * (điểm xuất phát <= đích): KR giảm dần (vd giảm bug từ 50 xuống 10) vượt đích nghĩa là nhỏ hơn đích — hợp lệ.
 * `start` trống coi là 0.
 */
export const CURRENT_OVER_TARGET_MESSAGE = 'Giá trị Hiện tại không được lớn hơn giá trị Cần đạt.';

export function currentOverTarget(
  start: number | null | undefined,
  target: number,
  current: number,
): boolean {
  return (start ?? 0) <= target && current > target;
}
