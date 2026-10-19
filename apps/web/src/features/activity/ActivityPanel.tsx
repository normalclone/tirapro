import { useState } from 'react';
import { Avatar, DelayedSpinner } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { CHIP_ROW_GAP_COARSE, CHIP_TOUCH_HIT } from '@/lib/touchHit';
import { fmtRelative } from '@/lib/dateFormat';
import { useOpenSession } from '@/lib/useOpenSession';
import { useRetained } from '@/lib/useRetained';
import { useIssueActivity, type ActivityItem } from './api';
import { ACTIVITY_FILTERS, describeActivity, fieldsParam } from './activityFilters';
import { DescriptionDiffDialog } from './DescriptionDiffDialog';

export function ActivityPanel({ issueId }: { issueId: string }) {
  // Bản chụp chip nhớ trong state panel (không localStorage); lọc ở máy chủ vì danh sách bị cắt 100 dòng.
  const [filter, setFilter] = useState('all');
  const fields = fieldsParam(filter);
  const filtered = useIssueActivity(issueId, fields);
  // Tổng CHƯA lọc cho tiêu đề (khi filter = Tất cả thì cùng khoá với `filtered` nên không tốn thêm yêu cầu).
  const all = useIssueActivity(issueId);
  // Không giữ danh sách của chip trước khi đổi chip (sẽ thoáng hiện dòng sai loại): chờ bản lọc, spinner chỉ hiện sau 350ms.
  const loading = filtered.data === undefined && !filtered.isError;
  const items = filtered.data ?? [];
  const total = all.data?.length;
  const [viewing, setViewing] = useState<ActivityItem | null>(null);
  const viewingShown = useRetained(viewing);
  const viewingKey = useOpenSession(!!viewing);

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-muted">
        Lịch sử (
        {fields && !loading && total !== undefined
          ? `${items.length}/${total}`
          : (total ?? items.length)}
        )
      </p>
      <div
        role="group"
        aria-label="Lọc lịch sử theo loại thay đổi"
        className={cn('mb-3 flex flex-wrap gap-x-1.5 gap-y-2', CHIP_ROW_GAP_COARSE)}
      >
        {ACTIVITY_FILTERS.map((f) => {
          const on = f.id === filter;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.id)}
              className={cn(
                'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors',
                CHIP_TOUCH_HIT,
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                on
                  ? 'border-transparent bg-primary-subtle text-primary'
                  : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      {loading ? (
        <DelayedSpinner />
      ) : items.length === 0 ? (
        <p className="text-sm text-faint">
          {filter === 'all' ? (
            'Chưa có hoạt động.'
          ) : (
            <>
              Không có thay đổi loại này.{' '}
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                Xem tất cả
              </button>
            </>
          )}
        </p>
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
                {describeActivity(a)}{' '}
                <span className="text-xs text-faint">{fmtRelative(a.occurredAt)}</span>
                {a.hasDiff && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => setViewing(a)}
                      className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      Xem thay đổi
                    </button>
                  </>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}
      {viewingShown && (
        <DescriptionDiffDialog
          key={viewingKey}
          open={!!viewing}
          issueId={issueId}
          item={viewingShown}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
