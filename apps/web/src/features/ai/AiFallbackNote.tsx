import { Link } from 'react-router-dom';
import type { AiFallbackReason } from '@tirapro/shared';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { aiFallbackNote } from './fallbackNote';

/**
 * Lời nhắc khi kết quả là heuristic. Chưa cấu hình + là admin hệ thống → thêm liên kết "Xem cấu hình AI"
 * tới /admin/config (người khác không thấy liên kết vì không vào được trang đó).
 */
export function AiFallbackNote({
  reason,
  variant = 'box',
}: {
  reason?: AiFallbackReason;
  variant?: 'box' | 'footnote' | 'plain';
}) {
  const isSystemAdmin = useAuth((s) => s.user?.isSystemAdmin === true);
  const note = aiFallbackNote(reason, isSystemAdmin ? 'admin' : 'user');
  if (!note) return null;
  return (
    <p
      className={cn(
        variant === 'box' && 'rounded-md bg-surface-2 px-3 py-2 text-sm text-muted',
        variant === 'footnote' && 'mt-1 border-t border-border px-2 pt-1.5 text-xs text-muted',
        variant === 'plain' && 'mt-1 text-xs text-muted',
      )}
    >
      {note}
      {reason === 'unconfigured' && isSystemAdmin && (
        <>
          {' '}
          <Link to="/admin/config" className="text-primary underline underline-offset-2">
            Xem cấu hình AI
          </Link>
        </>
      )}
    </p>
  );
}
