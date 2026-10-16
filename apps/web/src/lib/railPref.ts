/** Khoá localStorage của trạng thái thu/mở rail dự án — theo người dùng (hai tài khoản chung trình duyệt không lẫn nhau). */
export const railStorageKey = (userId: string | undefined): string =>
  `tirapro:projectRail:v1:${userId ?? 'anon'}`;

/** Số dự án tối đa để rail tự thu khi người dùng chưa từng chọn. */
const AUTO_COLLAPSE_MAX = 3;

/**
 * Rail thu gọn không? `stored` là giá trị đã lưu ('1' thu, '0' mở). Chưa từng chọn (null):
 * tự thu khi workspace có ≤ 3 dự án (Bảng việc cần chỗ); chưa biết số dự án → mở (không nháy).
 */
export function resolveRailCollapsed(
  stored: string | null,
  projectCount: number | undefined,
): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return projectCount !== undefined && projectCount <= AUTO_COLLAPSE_MAX;
}
