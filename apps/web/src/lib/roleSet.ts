/**
 * Bật/tắt một vai trò trong bộ vai trò đã chọn (thuần).
 * - Vai trò bị `locked` (id → lý do) không bỏ chọn được; khoá không cản việc THÊM.
 * - `frozen` (id → lý do): không bật cũng không tắt được (P-C14: vai trò mang quyền quản trị với người không phải quản trị).
 * - `requireOne`: không bỏ vai trò cuối cùng.
 * Không đổi được → trả đúng mảng đầu vào (so sánh `===` để nơi gọi biết không có thay đổi).
 */
export function toggleRoleIds(
  value: string[],
  id: string,
  opts: {
    requireOne: boolean;
    locked?: Record<string, string>;
    frozen?: Record<string, string>;
  },
): string[] {
  if (opts.frozen?.[id]) return value;
  if (!value.includes(id)) return [...value, id];
  if (opts.locked?.[id]) return value;
  if (opts.requireOne && value.length <= 1) return value;
  return value.filter((v) => v !== id);
}
