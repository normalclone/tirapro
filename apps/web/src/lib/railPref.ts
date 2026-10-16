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

/**
 * Rail thu gọn thật sự không? `base` = kết quả `resolveRailCollapsed` (lựa chọn đã lưu / tự động). Khi panel Epic của
 * Việc chờ đang mở (`epicOpen`) rail thu TẠM để hai panel phụ không cùng chiếm chỗ — KHÔNG ghi đè lựa chọn đã lưu,
 * nên đóng panel Epic là rail trở lại đúng trạng thái trước đó.
 */
export function railEffectiveCollapsed(base: boolean, epicOpen: boolean): boolean {
  return epicOpen || base;
}

/**
 * Bấm nút thu/mở rail: trả giá trị cần lưu (`pref`: '1' thu, '0' mở) và có phải thu panel Epic không.
 * `collapsed` = trạng thái đang thấy (đã gồm thu tạm). Rail đang thu vì Epic mở mà người dùng bấm MỞ → lưu "mở"
 * và thu panel Epic (loại trừ nhau).
 */
export function railToggleOutcome(
  collapsed: boolean,
  epicOpen: boolean,
): { pref: '0' | '1'; closeEpic: boolean } {
  return collapsed ? { pref: '0', closeEpic: epicOpen } : { pref: '1', closeEpic: false };
}
