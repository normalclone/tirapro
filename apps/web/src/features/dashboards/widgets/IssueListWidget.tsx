import { Link } from 'react-router-dom';
import { StatusPill } from '@/components/ui/StatusPill';
import { useJqlIssues } from '../api';
import { cfgNumber, cfgString } from '../widgetConfig';
import { useWidgetScope, useWidgetScopeInfo } from '../scope/ScopeContext';
import { issueListJql } from '../scope/widgetScope';
import { httpStatusOf, queryWidgetState, type WidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

/**
 * Danh sách việc theo câu lọc JQL, thu hẹp theo phạm vi của bảng (`project IN (…)` từ dự án người xem thấy). JQL bị máy chủ
 * che (gắn dự án người xem không thấy) → nói rõ thay vì hiện trống. Phạm vi không còn dự án nào → trống, KHÔNG chạy JQL
 * không giới hạn. Câu lọc mà quy trình của tổ chức không hiểu (máy chủ trả 422) → trống kèm lời giải thích, không phải lỗi.
 */
export function IssueListWidget({ title, config }: WidgetProps) {
  const base = cfgString(config, 'jql');
  const limit = cfgNumber(config, 'limit', 10);
  const masked = config.masked === true;
  const scope = useWidgetScope(config);
  const info = useWidgetScopeInfo();
  const jql = base ? issueListJql(base, scope, info) : undefined;
  const q = useJqlIssues(masked || !jql ? undefined : jql, limit);

  if (masked) {
    return (
      <WidgetFrame
        title={title}
        state="forbidden"
        forbiddenText="Bộ lọc này gắn với dự án bạn không có quyền xem"
      />
    );
  }
  if (!base) {
    return <WidgetFrame title={title} state="empty" emptyText="Chưa đặt câu lọc JQL cho ô này" />;
  }
  if (jql === null) {
    return (
      <WidgetFrame
        title={title}
        state="empty"
        emptyText="Phạm vi của bảng không có dự án nào bạn xem được"
      />
    );
  }
  if (q.isError && httpStatusOf(q.error) === 422) {
    return (
      <WidgetFrame
        title={title}
        state="empty"
        emptyText="Câu lọc này không áp dụng được với quy trình của tổ chức — hãy sửa câu lọc trong cấu hình ô"
      />
    );
  }

  const state: WidgetState = queryWidgetState(q, (d) => d.length === 0);
  return (
    <WidgetFrame
      title={title}
      state={state}
      error={q.error}
      onRetry={() => void q.refetch()}
      emptyText="Không có công việc nào khớp bộ lọc"
      to={{ href: `/filters?jql=${encodeURIComponent(jql ?? base)}`, label: 'Mở bộ lọc →' }}
    >
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {(q.data ?? []).map((issue) => (
          <li key={issue.id}>
            <Link
              to={`/issue/${issue.key}`}
              className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
            >
              <span className="shrink-0 font-mono text-xs text-muted">{issue.key}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{issue.summary}</span>
              <StatusPill status={issue.status} alwaysShowName />
            </Link>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  );
}
