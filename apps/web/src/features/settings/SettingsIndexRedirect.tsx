import { Navigate } from 'react-router-dom';
import { NAV_RULES, useNavVisible } from '@/lib/navAccess';

/**
 * `/settings` → trang cài đặt đầu tiên người dùng được xem: Thương hiệu cần `workspace:admin`,
 * người khác vào Thông báo (cá nhân, luôn xem được) — không đưa người thường thẳng vào "không có quyền".
 */
export function SettingsIndexRedirect() {
  const canGeneral = useNavVisible(NAV_RULES.settingsGeneral);
  return <Navigate to={canGeneral ? '/settings/general' : '/settings/notifications'} replace />;
}
