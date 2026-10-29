import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { AtSign, Bell, CheckCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { QueryError } from '@/components/ui/QueryError';
import { EmptyState } from '@/components/ui/primitives';
import { useAuth } from '@/stores/auth';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationsPopover,
  useUnreadCount,
  type NotificationItem,
} from './api';
import {
  BELL_TABS,
  bellEmptyText,
  notificationsHref,
  readBellTab,
  writeBellTab,
  type BellTab,
} from './bellTabs';
import { NotificationRow } from './NotificationRow';
import { notificationHref } from './notificationHref';

const EMPTY_ICON: Record<BellTab, JSX.Element> = {
  all: <Bell className="h-6 w-6" />,
  mentioned: <AtSign className="h-6 w-6" />,
  assigned: <UserPlus className="h-6 w-6" />,
};

export function NotificationBell() {
  const userId = useAuth((s) => s.user?.id);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BellTab>(() => readBellTab(userId));
  // Chỉ tab đang mở truy vấn (và chỉ khi popover mở): không tải cả ba tab.
  const query = useNotificationsPopover(tab, open);
  const items = query.data ?? [];
  const { data: unread = 0 } = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const navigate = useNavigate();

  function selectTab(next: BellTab) {
    setTab(next);
    writeBellTab(userId, next);
  }

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
          className="z-dropdown w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="text-sm font-semibold text-ink-strong">Thông báo</span>
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={unread === 0 || markAllRead.isPending}
              title="Đánh dấu toàn bộ thông báo chưa đọc của bạn là đã đọc (không chỉ tab đang xem)"
              // Giữ disabled:opacity (không dùng token vô hiệu) — nút chữ ghost không nền: chỉ cần mờ đi.
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary-subtle disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Đánh dấu đã đọc tất cả
            </button>
          </div>

          <Tabs
            idBase="bell"
            ariaLabel="Lọc thông báo"
            value={tab}
            onChange={selectTab}
            items={BELL_TABS}
            className="px-2"
          />

          <TabPanel idBase="bell" value={tab} className="min-h-56">
            {query.isError && items.length === 0 ? (
              <div className="p-3">
                <QueryError error={query.error} onRetry={() => void query.refetch()} />
              </div>
            ) : query.isPending ? (
              <p role="status" className="px-3 py-10 text-center text-sm text-faint">
                Đang tải…
              </p>
            ) : items.length === 0 ? (
              <div className="p-3">
                <EmptyState size="compact" icon={EMPTY_ICON[tab]} title={bellEmptyText(tab)} />
              </div>
            ) : (
              <ul className="max-h-[min(24rem,calc(100dvh-14rem))] overflow-y-auto py-1">
                {items.map((n) => (
                  <NotificationRow key={n.id} item={n} dense onActivate={() => activate(n)} />
                ))}
              </ul>
            )}
          </TabPanel>

          <Link
            to={notificationsHref(tab)}
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
