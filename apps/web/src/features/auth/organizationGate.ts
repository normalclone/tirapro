/**
 * Tài khoản chưa thuộc tổ chức nào (`organizationId` null) không có gì để xem ở khung ứng dụng —
 * mọi truy vấn theo tổ chức đều 403. Chặn MỘT chỗ ở `RequireAuth` thay vì vá từng trang.
 * Ngoại lệ: admin hệ thống vẫn vào được `/admin*` (để gán tài khoản vào tổ chức).
 */
export function needsOrganizationScreen(
  auth: { organizationId: string | null; isSystemAdmin: boolean },
  pathname: string,
): boolean {
  if (auth.organizationId) return false;
  const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  return !(auth.isSystemAdmin && inAdmin);
}
