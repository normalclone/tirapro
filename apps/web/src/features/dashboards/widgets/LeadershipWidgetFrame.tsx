import type { ReactNode } from 'react';
import { useAuth } from '@/stores/auth';
import { isUnavailable } from '@/features/dashboard/leadershipText';
import { useLeadership, type LeadershipCard } from '@/features/dashboard/api';
import { queryWidgetState, type WidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';

/** Khung chung của 3 ô lãnh đạo: cùng một request `/reports/leadership`, mỗi ô tự rỗng/lỗi độc lập. */
export function LeadershipWidgetFrame({
  title,
  card,
  to,
  empty,
  render,
}: {
  title: string;
  card: LeadershipCard;
  to: { href: string; label: string };
  empty: string;
  render: (data: NonNullable<ReturnType<typeof useLeadership>['data']>) => ReactNode[];
}) {
  const canReport = useAuth((s) => s.can('report:view'));
  const q = useLeadership(canReport);

  if (!canReport) {
    return <WidgetFrame title={title} state="forbidden" forbiddenText="Cần quyền xem báo cáo" />;
  }
  const rows = q.data ? render(q.data) : [];
  let state: WidgetState = queryWidgetState(q);
  // Nguồn của thẻ lỗi: KHÔNG hiện "không có gì" (giả như mọi thứ ổn).
  if (state === 'ready' && isUnavailable(q.data, card)) state = 'error';
  else if (state === 'ready' && rows.length === 0) state = 'empty';

  return (
    <WidgetFrame
      title={title}
      state={state}
      error={q.error}
      onRetry={() => void q.refetch()}
      emptyText={empty}
      to={to}
    >
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {rows}
      </ul>
    </WidgetFrame>
  );
}
