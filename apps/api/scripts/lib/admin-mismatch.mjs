/**
 * Một vai trò "Quản trị": `User.isSystemAdmin` phải khớp "giữ vai trò có quyền organization:admin ở ít nhất một tổ chức".
 * Hàm thuần (không DB) để test được; `check-admins.mjs` nạp dữ liệu rồi gọi hàm này.
 *
 * `users`: [{ id, email, displayName, status, isSystemAdmin, adminOrganizations: string[] }].
 * Trả về những người LỆCH, kèm loại lệch:
 *  - `FLAG_WITHOUT_ROLE`: là Quản trị hệ thống nhưng không là Quản trị tổ chức nào;
 *  - `ROLE_WITHOUT_FLAG`: là Quản trị tổ chức nhưng chưa là Quản trị hệ thống.
 * Tài khoản đã vô hiệu hoá và tài khoản hệ thống của tự động hoá bị bỏ qua.
 */
export function findAdminMismatches(users, systemEmail = 'automation@tirapro.local') {
  const out = [];
  for (const u of users) {
    if (u.status === 'DEACTIVATED' || u.email === systemEmail) continue;
    const hasRole = u.adminOrganizations.length > 0;
    if (u.isSystemAdmin && !hasRole) out.push({ ...u, kind: 'FLAG_WITHOUT_ROLE' });
    else if (!u.isSystemAdmin && hasRole) out.push({ ...u, kind: 'ROLE_WITHOUT_FLAG' });
  }
  return out;
}
