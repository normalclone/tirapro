import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BellOff, CheckCheck } from 'lucide-react';
import { notificationFilterSchema, type NotificationFilter } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { EmptyState } from '@/components/ui/primitives';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { APP_NAV_LABELS } from '@/lib/navLabels';
import { NotificationRow } from './NotificationRow';
import { notificationHref } from './notificationHref';
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationsPage,
  useUnreadCount,
  type NotificationItem,
} from './api';

const TABS: { id: NotificationFilter; label: string; empty: string }[] = [
  { id: 'all', label: 'Tất cả', empty: 'Chưa có thông báo nào.' },
  { id: 'unread', label: 'Chưa đọc', empty: 'Bạn đã xem hết thông báo.' },
  { id: 'mentioned', label: 'Được nhắc', empty: 'Chưa ai nhắc đến bạn.' },
  { id: 'assigned', label: 'Được giao', empty: 'Chưa có công việc nào được giao cho bạn.' },
];

/** Trang đầy đủ `/notifications` — tab lọc lưu trên URL (`?tab=`), "Tải thêm" thay cho cuộn vô hạn. */
export function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = notificationFilterSchema.parse(params.get('tab'));
  const navigate = useNavigate();

  const query = useNotificationsPage(tab);
  const { data: unread = 0 } = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  function selectTab(id: NotificationFilter) {
    setParams(id === 'all' ? {} : { tab: id }, { replace: true });
  }

  function activate(n: NotificationItem) {
    if (!n.readAt) markRead.mutate(n.id);
    const href = notificationHref(n.payload);
    if (href) navigate(href);
  }

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <PageFrame size="sm">
      <PageHeader
        title={APP_NAV_LABELS.notifications}
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => markAllRead.mutate()}
            disabled={unread === 0 || markAllRead.isPending}
            title="Đánh dấu toàn bộ thông báo chưa đọc của bạn là đã đọc (không chỉ tab đang xem)"
          >
            <CheckCheck className="h-4 w-4" /> Đánh dấu đã đọc tất cả
          </Button>
        }
      />

      <Tabs
        idBase="notif"
        ariaLabel="Lọc thông báo"
        value={tab}
        onChange={selectTab}
        items={TABS}
        className="mb-4 overflow-x-auto"
      />

      <TabPanel idBase="notif" value={tab}>
        <QueryBoundary
          query={query}
          empty={(d) => d.pages.every((p) => p.data.length === 0)}
          emptyState={<EmptyState icon={<BellOff className="h-6 w-6" />} title={current.empty} />}
        >
          {(d) => (
            <>
              <ul className="overflow-hidden rounded-lg border border-border bg-surface divide-y divide-border">
                {d.pages
                  .flatMap((p) => p.data)
                  .map((n) => (
                    <NotificationRow key={n.id} item={n} onActivate={() => activate(n)} />
                  ))}
              </ul>
              {query.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void query.fetchNextPage()}
                    disabled={query.isFetchingNextPage}
                  >
                    {query.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
                  </Button>
                </div>
              )}
            </>
          )}
        </QueryBoundary>
        <p className="mt-6 text-center text-xs text-faint">
          Chọn loại thông báo nhận được ở{' '}
          <Link to="/settings/notifications" className="text-primary hover:underline">
            Cài đặt thông báo
          </Link>
          .
        </p>
      </TabPanel>
    </PageFrame>
  );
}
