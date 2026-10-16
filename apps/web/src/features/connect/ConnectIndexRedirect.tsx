import { Navigate } from 'react-router-dom';
import { NAV_RULES, useNavVisible } from '@/lib/navAccess';

/** `/connect` → tab đầu tiên người dùng được thấy (không có quyền Ứng dụng bên ngoài thì vào Tự động hoá). */
export function ConnectIndexRedirect() {
  const canIntegrations = useNavVisible(NAV_RULES.connectIntegrations);
  return (
    <Navigate to={canIntegrations ? '/connect/integrations' : '/connect/automation'} replace />
  );
}
