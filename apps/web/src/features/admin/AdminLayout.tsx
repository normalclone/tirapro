import { Outlet } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { NoAccess } from '@/components/ui/NoAccess';

/**
 * Cổng vào console quản trị hệ thống — chỉ admin hệ thống (isSystemAdmin).
 * Không có chrome riêng: sidebar + header do AppShell đổi sang "chế độ admin"
 * (menu admin, không có bộ chọn không gian làm việc). Ở đây chỉ gác quyền + render trang con.
 * Người không đủ quyền thấy trang "không có quyền" có lối về, không bị chuyển hướng im lặng.
 */
export function AdminLayout() {
  const me = useAuth((s) => s.user);
  if (me && !me.isSystemAdmin) return <NoAccess who="quản trị hệ thống" />;
  return <Outlet />;
}
