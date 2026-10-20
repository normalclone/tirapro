/**
 * Bật/tắt một vai trò trong bộ vai trò đã chọn (thuần).
 * - Vai trò bị `locked` (id → lý do) không bỏ chọn được; khoá không cản việc THÊM.
 * - `requireOne`: không bỏ vai trò cuối cùng.
 * Không đổi được → trả đúng mảng đầu vào (so sánh `===` để nơi gọi biết không có thay đổi).
 */
export function toggleRoleIds(
  value: string[],
  id: string,
  opts: { requireOne: boolean; locked?: Record<string, string> },
): string[] {
  if (!value.includes(id)) return [...value, id];
  if (opts.locked?.[id]) return value;
  if (opts.requireOne && value.length <= 1) return value;
  return value.filter((v) => v !== id);
}
