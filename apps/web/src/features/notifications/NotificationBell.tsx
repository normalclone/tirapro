import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { formatDistanceToNow } from 'date-fns';
import {
  AtSign,
  Bell,
  CheckCheck,
  Eye,
  Flag,
  FlagOff,
  MessageSquare,
  RefreshCw,
  Repeat,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
  type NotificationItem,
  type NotificationType,
} from './api';

/** Nhãn tiếng Việt + icon theo loại thông báo. */
const TYPE_META: Record<NotificationType, { label: string; Icon: LucideIcon }> = {
  ISSUE_ASSIGNED: { label: 'Được giao', Icon: UserPlus },
  MENTIONED: { label: 'Nhắc đến', Icon: AtSign },
  COMMENT_ADDED: { label: 'Bình luận', Icon: MessageSquare },
  STATUS_CHANGED: { label: 'Đổi trạng thái', Icon: Repeat },
  ISSUE_UPDATED: { label: 'Cập nhật', Icon: RefreshCw },
  SPRINT_STARTED: { label: 'Sprint bắt đầu', Icon: Flag },
  SPRINT_COMPLETED: { label: 'Sprint xong', Icon: FlagOff },
  WATCHING_UPDATE: { label: 'Theo dõi', Icon: Eye },
};

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDistanceToNow(d, { addSuffix: true });
}

export function NotificationBell() {
  const { data: items = [] } = useNotifications();
  const { data: unread = 0 } = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const badge = unread > 9 ? '9+' : String(unread);

  // Bấm 1 thông báo: đánh dấu đã đọc + mở issue liên quan (nếu có) + đóng popover.
  function activate(n: NotificationItem) {
    if (!n.readAt) markRead.mutate(n.id);
    const key = n.payload?.key;
    if (key) {
      navigate(`/issue/${key}`);
      setOpen(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Thông báo (${unread} chưa đọc)` : 'Thông báo'}
          title="Thông báo"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-fg"
              aria-hidden="true"
            >
              {badge}
            </span>
          )}
        </Button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-dropdown w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="text-sm font-semibold text-ink-strong">Thông báo</span>
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={unread === 0 || markAllRead.isPending}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary-subtle disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Đánh dấu đã đọc hết
            </button>
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-faint">Không có thông báo.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {items.map((n) => (
                <NotificationRow key={n.id} item={n} onActivate={() => activate(n)} />
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotificationRow({ item, onActivate }: { item: NotificationItem; onActivate: () => void }) {
  const meta = TYPE_META[item.type] ?? { label: item.type, Icon: Bell };
  const { Icon } = meta;
  const unread = !item.readAt;
  const key = item.payload?.key;
  const summary = item.payload?.summary;
  const time = relativeTime(item.createdAt);

  return (
    <li>
      <button
        type="button"
        onClick={onActivate}
        className={cn(
          'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2',
          unread && 'bg-primary-subtle/60 hover:bg-primary-subtle',
        )}
      >
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-2 text-muted">
          <Icon className="h-3.5 w-3.5" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-ink-strong">{meta.label}</span>
            {key && <span className="shrink-0 font-mono text-[11px] text-muted">{key}</span>}
          </span>
          {summary && <span className="mt-0.5 block truncate text-sm text-ink">{summary}</span>}
          {time && <span className="mt-0.5 block text-[11px] text-faint">{time}</span>}
        </span>

        {unread && (
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
            aria-label="Chưa đọc"
          />
        )}
      </button>
    </li>
  );
}
