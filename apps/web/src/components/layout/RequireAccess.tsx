import { Outlet } from 'react-router-dom';
import { NoAccess } from '@/components/ui/NoAccess';
import { useNavVisible, type NavRule } from '@/lib/navAccess';

/**
 * Bọc route theo quyền: gõ URL trực tiếp cũng ra "không có quyền" thay vì form dùng được rồi 403.
 * Đặt dưới `RequireAuth` (đã đảm bảo `status === 'authed'` nên quyền đã tải).
 */
export function RequireAccess({ rule, who }: { rule: NavRule; who?: string }) {
  const ok = useNavVisible(rule);
  return ok ? <Outlet /> : <NoAccess who={who} />;
}
