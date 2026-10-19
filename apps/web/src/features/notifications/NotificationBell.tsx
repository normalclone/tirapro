import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
  type NotificationItem,
} from './api';
import { NotificationRow } from './NotificationRow';
import { notificationHref } from './notificationHref';

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
    const href = notificationHref(n.payload);
    if (href) {
      navigate(href);
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
              // Giữ disabled:opacity (không dùng token vô hiệu) — nút chữ ghost không nền: chỉ cần mờ đi.
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary-subtle disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Đánh dấu đã đọc tất cả
            </button>
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-faint">Không có thông báo.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {items.map((n) => (
                <NotificationRow key={n.id} item={n} dense onActivate={() => activate(n)} />
              ))}
            </ul>
          )}

          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-3 py-2.5 text-center text-xs font-medium text-primary transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
          >
            Xem tất cả thông báo →
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
