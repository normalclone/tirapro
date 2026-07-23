import { formatDistanceToNow } from 'date-fns';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { useIssueActivity, type ActivityItem } from './api';

/** Giá trị hiển thị, rỗng → dấu gạch. */
function val(v: string | null): string {
  return v != null && v !== '' ? v : '—';
}

/** Mô tả tiếng Việt cho một thay đổi, dựng từ field + giá trị cũ/mới. */
function describe(a: ActivityItem): string {
  switch (a.field) {
    case 'STATUS':
      return a.oldValue
        ? `đổi trạng thái: ${a.oldValue} → ${val(a.newValue)}`
        : `đổi trạng thái: → ${val(a.newValue)}`;
    case 'ASSIGNEE':
      return 'đổi người thực hiện';
    case 'PRIORITY':
      return `đổi ưu tiên: ${val(a.oldValue)} → ${val(a.newValue)}`;
    case 'STORY_POINTS':
      return `đổi điểm: ${val(a.oldValue)} → ${val(a.newValue)}`;
    case 'SPRINT':
      return 'chuyển sprint';
    case 'TYPE':
      return 'đổi loại';
    case 'RESOLUTION':
      return 'đổi resolution';
    case 'SCOPE':
      return 'thay đổi phạm vi';
    default:
      return `${a.field}: ${val(a.oldValue)} → ${val(a.newValue)}`;
  }
}

export function ActivityPanel({ issueId }: { issueId: string }) {
  const { data } = useIssueActivity(issueId);
  const items = data ?? [];

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-muted">Lịch sử ({items.length})</p>
      {items.length === 0 ? (
        <p className="text-sm text-faint">Chưa có hoạt động.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="flex gap-2.5">
              {a.actor ? (
                <Avatar name={a.actor.displayName} src={a.actor.avatarUrl} size={22} />
              ) : (
                <span
                  className="mt-1 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-faint"
                  style={{ marginLeft: 'calc(11px - 0.1875rem)' }}
                  aria-hidden
                />
              )}
              <p className={cn('min-w-0 flex-1 text-sm text-ink')}>
                <b className="font-medium text-ink-strong">{a.actor?.displayName ?? 'Hệ thống'}</b>{' '}
                {describe(a)}{' '}
                <span className="text-xs text-faint">
                  {formatDistanceToNow(new Date(a.occurredAt), { addSuffix: true })}
                </span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
