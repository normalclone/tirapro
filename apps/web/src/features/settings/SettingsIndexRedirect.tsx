import { Navigate } from 'react-router-dom';

/** `/settings` → Thông báo (cá nhân, ai cũng xem được). Thương hiệu và các mục quản trị khác nằm ở Quản trị hệ thống. */
export function SettingsIndexRedirect() {
  return <Navigate to="/settings/notifications" replace />;
}
