/** Khoá localStorage của trạng thái thu/mở rail dự án — theo người dùng (hai tài khoản chung trình duyệt không lẫn nhau). */
export const railStorageKey = (userId: string | undefined): string =>
  `tirapro:projectRail:v1:${userId ?? 'anon'}`;

/** Khoá lưu kết quả TỰ ĐỘNG lần trước (khi người dùng chưa chọn) — để lần mở sau vẽ đúng ngay, không nháy mở rồi thu. */
export const railAutoKey = (userId: string | undefined): string =>
  `tirapro:projectRail:v1:auto:${userId ?? 'anon'}`;

/** Số dự án tối đa để rail tự thu khi người dùng chưa từng chọn. */
const AUTO_COLLAPSE_MAX = 3;

/**
 * Rail thu gọn không? `stored` là giá trị đã lưu ('1' thu, '0' mở). Chưa từng chọn (null):
 * tự thu khi workspace có ≤ 3 dự án ĐANG HOẠT ĐỘNG (Bảng việc cần chỗ). Chưa biết số dự án (cache trống) → dùng kết quả
 * tự động lần trước (`lastAuto`), không có thì mở.
 */
export function resolveRailCollapsed(
  stored: string | null,
  activeCount: number | undefined,
  lastAuto?: boolean,
): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  if (activeCount === undefined) return lastAuto ?? false;
  return activeCount <= AUTO_COLLAPSE_MAX;
}
