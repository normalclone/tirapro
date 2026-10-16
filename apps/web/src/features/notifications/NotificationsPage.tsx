import { useRef, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import { notificationFilterSchema, type NotificationFilter } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { EmptyState } from '@/components/ui/primitives';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { NotificationRow } from './NotificationRow';
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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const navigate = useNavigate();

  const query = useNotificationsPage(tab);
  const { data: unread = 0 } = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  function selectTab(id: NotificationFilter) {
    setParams(id === 'all' ? {} : { tab: id }, { replace: true });
  }

  /** Mũi tên trái/phải, Home/End chuyển tab như tablist chuẩn. */
  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    selectTab(TABS[next]!.id);
    tabRefs.current[next]?.focus();
  }

  function activate(n: NotificationItem) {
    if (!n.readAt) markRead.mutate(n.id);
    const key = n.payload?.key;
    if (key) navigate(`/issue/${key}`);
  }

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className={pageContainer('sm')}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Thông báo</h1>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => markAllRead.mutate()}
          disabled={unread === 0 || markAllRead.isPending}
          title="Đánh dấu toàn bộ thông báo chưa đọc của bạn là đã đọc (không chỉ tab đang xem)"
        >
          <CheckCheck className="h-4 w-4" /> Đánh dấu đã đọc tất cả
        </Button>
      </header>

      <div
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
        role="tablist"
        aria-label="Lọc thông báo"
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`notif-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="notif-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => selectTab(t.id)}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              tab === t.id
                ? 'border-primary text-ink-strong'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="notif-panel" aria-labelledby={`notif-tab-${tab}`}>
        <QueryBoundary
          query={query}
          empty={(d) => d.pages.every((p) => p.data.length === 0)}
          emptyState={<EmptyState title={current.empty} />}
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
      </div>
    </div>
  );
}
