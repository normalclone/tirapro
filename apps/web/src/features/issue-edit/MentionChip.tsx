import { useAuth } from '@/stores/auth';
import { useSearchUsers } from '@/features/members/api';
import { resolveMentionName } from './mentionQuery';
import { cn } from '@/lib/utils';

/**
 * Chip `@Tên` cho token `@[Tên](user:id)` đã đăng. Không là liên kết (chưa có trang hồ sơ).
 * Tên lấy theo id (không tin tên trong token). Chip của chính người đang đăng nhập nổi bật để họ thấy mình được nhắc.
 */
export function MentionChip({ id, name: tokenName }: { id: string; name: string }) {
  const me = useAuth((s) => s.user?.id);
  // Chỉ để TRA TÊN theo id cho @mention đã có trong văn bản: gồm cả tài khoản đã khoá.
  const { data: users } = useSearchUsers({ includeInactive: true, limit: 200 });
  const name = resolveMentionName(users, id, tokenName);
  return (
    <span
      title={name}
      className={cn(
        'rounded px-1 py-0.5 text-[0.92em] font-medium',
        id === me ? 'bg-primary-subtle text-primary' : 'bg-surface-2 text-ink',
      )}
    >
      @{name}
    </span>
  );
}
