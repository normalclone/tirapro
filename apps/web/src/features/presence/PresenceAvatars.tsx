import type { PresenceUser } from '@tirapro/shared';
import { Avatar } from '@/components/ui/primitives';
import { usePresence } from './usePresence';

const MAX_AVATARS = 5;

type Props =
  | { room: 'project'; projectId: string | undefined }
  | { room: 'issue'; projectId: string | undefined; issueId: string };

/**
 * Chồng avatar những người đang trực tuyến (tối đa 5 + "+N"). Ở room project, người đang mở một
 * công việc có chấm xanh. Ở room issue chỉ hiện những người đang xem chính công việc đó.
 */
export function PresenceAvatars(props: Props) {
  const issueId = props.room === 'issue' ? props.issueId : undefined;
  const users = usePresence(props.projectId, issueId);
  if (users.length === 0) return null;

  const shown = users.slice(0, MAX_AVATARS);
  const extra = users.length - shown.length;
  const label =
    props.room === 'issue'
      ? `${users.length} người khác đang xem công việc này`
      : `${users.length} người khác đang mở dự án này`;

  return (
    <div role="group" aria-label={label} className="flex items-center -space-x-1.5">
      {shown.map((u) => (
        <PresenceAvatar key={u.userId} user={u} showDot={props.room === 'project'} />
      ))}
      {extra > 0 && (
        <span
          className="tabular z-0 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-2 px-1 text-[10px] font-semibold text-muted ring-2 ring-surface"
          title={users.slice(MAX_AVATARS).map((u) => u.displayName).join(', ')}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

function PresenceAvatar({ user, showDot }: { user: PresenceUser; showDot: boolean }) {
  const viewing = showDot && !!user.viewing;
  return (
    <span className="relative inline-flex rounded-full ring-2 ring-surface">
      <Avatar name={viewing ? `${user.displayName} — đang xem một công việc` : user.displayName} src={user.avatarUrl} size={24} />
      {viewing && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-surface"
        />
      )}
    </span>
  );
}
