/**
 * P-C14 (phản chiếu máy chủ): chỉ người đang giữ `workspace:admin` (hoặc admin hệ thống) mới cấp/gỡ quyền quản trị — qua
 * vai trò của thành viên hoặc bộ quyền của vai trò. `member:manage` một mình không đủ. Người khác thấy các điều khiển đó
 * bị khoá kèm lý do (máy chủ vẫn trả 403 `ADMIN_GRANT_REQUIRES_ADMIN` nếu có lối nào lọt).
 * Nơi dùng: `useAuth((s) => s.can('workspace:admin'))` (đã gồm admin hệ thống) làm `canGrantAdmin`.
 */
export const ADMIN_GRANT_REASON = 'Chỉ quản trị mới cấp/gỡ quyền này';

const ADMIN = 'workspace:admin';

/** Vai trò mang `workspace:admin` bị đóng băng (không bật, không tắt) với người không phải quản trị: id → lý do. */
export function frozenAdminRoles(
  canGrantAdmin: boolean,
  adminRoleIds: ReadonlySet<string>,
): Record<string, string> {
  if (canGrantAdmin) return {};
  return Object.fromEntries([...adminRoleIds].map((id) => [id, ADMIN_GRANT_REASON]));
}

/** Vai trò đang giữ `workspace:admin`: người không phải quản trị không sửa/nhân bản được (máy chủ đòi quản trị). */
export function roleLockedForAdminGrant(
  canGrantAdmin: boolean,
  roleKeys: readonly string[],
): boolean {
  return !canGrantAdmin && roleKeys.includes(ADMIN);
}

/** Ô quyền khoá: chính quyền `workspace:admin` (mọi vai trò) hoặc mọi quyền của vai trò đang giữ nó. */
export function permLockedForAdminGrant(
  canGrantAdmin: boolean,
  roleKeys: readonly string[],
  permKey: string,
): boolean {
  return !canGrantAdmin && (permKey === ADMIN || roleKeys.includes(ADMIN));
}

/** Ô nhóm khoá: nhóm chứa `workspace:admin` hoặc vai trò đang giữ nó. */
export function groupLockedForAdminGrant(
  canGrantAdmin: boolean,
  roleKeys: readonly string[],
  groupKeys: readonly string[],
): boolean {
  return !canGrantAdmin && (groupKeys.includes(ADMIN) || roleKeys.includes(ADMIN));
}
