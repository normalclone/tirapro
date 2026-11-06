import type { ReactNode } from 'react';
import { useAuth } from '@/stores/auth';
import { isUnavailable } from '@/features/dashboard/leadershipText';
import type { LeadershipCard } from '@/features/dashboard/api';
import { useWidgetScope } from '../scope/ScopeContext';
import { aggregateIds } from '../scope/widgetScope';
import { useScopedLeadership } from '../scope/scopedReports';
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
  to?: { href: string; label: string };
  empty: string;
  render: (data: NonNullable<ReturnType<typeof useScopedLeadership>['data']>) => ReactNode[];
}) {
  const canReport = useAuth((s) => s.can('report:view'));
  const scope = useWidgetScope({});
  const ids = aggregateIds(scope);
  // Thẻ nhân lực đo người trên MỌI dự án nên không thu hẹp theo nhóm/dự án được: ngoài phạm vi toàn tổ chức nó trống có lý do.
  const orgOnly = card === 'overloaded' && ids !== null;
  // Toàn tổ chức cần quyền báo cáo cấp tổ chức; nhóm dự án: máy chủ cho qua nếu có quyền trong từng dự án (403 → ô báo thiếu quyền).
  const blocked = ids === null && !canReport;
  const q = useScopedLeadership(ids, !blocked && !orgOnly);

  if (blocked) {
    return <WidgetFrame title={title} state="forbidden" forbiddenText="Cần quyền xem báo cáo" />;
  }
  if (orgOnly) {
    return (
      <WidgetFrame
        title={title}
        state="empty"
        emptyText="Thẻ này chỉ có khi bảng lấy số liệu toàn tổ chức"
      />
    );
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
