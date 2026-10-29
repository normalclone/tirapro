/**
 * P-C14 — chỉ người đang giữ `workspace:admin` (hoặc admin hệ thống) mới cấp/gỡ quyền quản trị workspace.
 * Phần thuần (không DB) của luật đó, để test được riêng; phần tra DB nằm ở `RbacService`.
 */

/**
 * Những vai trò MANG `workspace:admin` mà việc đổi bộ vai trò từ `before` sang `after` THÊM hoặc GỠ (hiệu đối xứng).
 * Giữ nguyên một vai trò quản trị không tính là thay đổi; đổi vai trò quản trị này sang vai trò quản trị khác thì tính
 * (gỡ một + thêm một).
 */
export function touchedAdminRoleIds(
  before: readonly string[],
  after: readonly string[],
  adminRoleIds: ReadonlySet<string>,
): string[] {
  const b = new Set(before);
  const a = new Set(after);
  const touched: string[] = [];
  for (const id of new Set([...b, ...a])) {
    if (!adminRoleIds.has(id)) continue;
    if (b.has(id) !== a.has(id)) touched.push(id);
  }
  return touched;
}
