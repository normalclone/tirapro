/**
 * Tài khoản chưa thuộc không gian làm việc nào (`workspaceId` null) không có gì để xem ở khung ứng dụng —
 * mọi truy vấn theo workspace đều 403. Chặn MỘT chỗ ở `RequireAuth` thay vì vá từng trang.
 * Ngoại lệ: admin hệ thống vẫn vào được `/admin*` (để gán tài khoản vào workspace).
 */
export function needsWorkspaceScreen(
  auth: { workspaceId: string | null; isSystemAdmin: boolean },
  pathname: string,
): boolean {
  if (auth.workspaceId) return false;
  const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  return !(auth.isSystemAdmin && inAdmin);
}
