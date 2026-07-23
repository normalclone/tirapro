import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/stores/auth';

/**
 * Cổng vào console quản trị hệ thống — chỉ admin hệ thống (isSystemAdmin).
 * Không có chrome riêng: sidebar + header do AppShell đổi sang "chế độ admin"
 * (menu admin, không có bộ chọn workspace). Ở đây chỉ gác quyền + render trang con.
 */
export function AdminLayout() {
  const me = useAuth((s) => s.user);
  if (me && !me.isSystemAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
