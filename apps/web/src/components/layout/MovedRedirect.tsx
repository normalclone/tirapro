import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';

/**
 * Chuyển hướng đường dẫn cũ về chỗ mới, kèm một dòng thông báo nói mục đó giờ ở đâu (nếu có). `id` cố định để chạy
 * hai lần trong StrictMode vẫn chỉ hiện MỘT thông báo.
 */
export function MovedRedirect({ to, message }: { to: string; message?: string }) {
  useEffect(() => {
    if (message) toast.info(message, { id: `moved:${message}`, duration: 6000 });
  }, [message]);
  return <Navigate to={to} replace />;
}
