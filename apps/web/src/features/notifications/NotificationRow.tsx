import {
  AtSign,
  Bell,
  Eye,
  Flag,
  FlagOff,
  MessageSquare,
  RefreshCw,
  Repeat,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { buildNotificationTitle } from '@tirapro/shared';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { fmtDateTime, fmtRelative } from '@/lib/dateFormat';
import type { NotificationItem, NotificationType } from './api';
import { actorDisplay } from './bellTabs';

/** Icon theo loại thông báo (nhãn chữ đã nằm trong câu tiêu đề). */
const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  ISSUE_ASSIGNED: UserPlus,
  MENTIONED: AtSign,
  COMMENT_ADDED: MessageSquare,
  STATUS_CHANGED: Repeat,
  ISSUE_UPDATED: RefreshCw,
  SPRINT_STARTED: Flag,
  SPRINT_COMPLETED: FlagOff,
  WATCHING_UPDATE: Eye,
};

/** Loại có trích đoạn nội dung đáng hiển thị. */
const SHOWS_EXCERPT: ReadonlySet<NotificationType> = new Set(['MENTIONED', 'COMMENT_ADDED']);

/**
 * Một dòng thông báo — dùng chung cho chuông và trang /notifications.
 * Ba tầng: (1) câu "ai làm gì ở đâu" (2) tiêu đề công việc, mờ (3) trích đoạn bình luận/mô tả.
 * Chưa đọc: nền nhạt + chấm xanh có nhãn (không dùng viền một bên — DESIGN.md).
 */
export function NotificationRow({
  item,
  onActivate,
  dense = false,
}: {
  item: NotificationItem;
  onActivate: () => void;
  /** Popover chuông: trích đoạn một dòng. */
  dense?: boolean;
}) {
  const Icon = TYPE_ICON[item.type] ?? Bell;
  const unread = !item.readAt;
  const payload = item.payload ?? {};
  // `actorId` cho phép phân biệt "Một thành viên" (có người làm, thiếu tên) với "Hệ thống" (không có người làm).
  const title = buildNotificationTitle(item.type, {
    ...payload,
    ...(item.actorId ? { actorId: item.actorId } : {}),
  });
  const excerpt = SHOWS_EXCERPT.has(item.type) ? payload.excerpt : undefined;
  const time = fmtRelative(item.createdAt);
  const actor = actorDisplay(item);

  return (
    <li>
      <button
        type="button"
        onClick={onActivate}
        className={cn(
          'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none',
          unread && 'bg-primary-subtle/60 hover:bg-primary-subtle',
        )}
      >
        {actor ? (
          // Avatar trang trí (tên đã có trong câu tiêu đề) + chip icon loại hành động ở góc.
          <span className="relative mt-0.5 shrink-0">
            <Avatar name={actor.name} src={actor.avatarUrl} size={28} decorative />
            <span
              aria-hidden="true"
              className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-surface text-muted ring-2 ring-surface"
            >
              <Icon className="h-2.5 w-2.5" />
            </span>
          </span>
        ) : (
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-2 text-muted">
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink-strong">{title}</span>
          {payload.summary && (
            <span className="mt-0.5 block truncate text-xs text-muted">{payload.summary}</span>
          )}
          {excerpt && (
            <span
              className={cn(
                'mt-1 block text-sm italic text-ink',
                dense ? 'truncate' : 'line-clamp-2',
              )}
            >
              {excerpt}
            </span>
          )}
          {time && (
            <span
              className="mt-0.5 block text-[11px] text-faint"
              title={fmtDateTime(item.createdAt)}
            >
              {time}
            </span>
          )}
        </span>

        {unread && (
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Chưa đọc" />
        )}
      </button>
    </li>
  );
}
