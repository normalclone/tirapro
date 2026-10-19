import { Link } from 'react-router-dom';
import { StatusPill } from '@/components/ui/StatusPill';
import { useJqlIssues } from '../api';
import { cfgNumber, cfgString } from '../widgetConfig';
import { queryWidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

/** Danh sách việc theo câu lọc JQL. JQL bị máy chủ che (gắn dự án người xem không thấy) → nói rõ thay vì hiện trống. */
export function IssueListWidget({ title, config }: WidgetProps) {
  const jql = cfgString(config, 'jql');
  const limit = cfgNumber(config, 'limit', 10);
  const masked = config.masked === true;
  const q = useJqlIssues(masked ? undefined : jql, limit);

  if (masked) {
    return (
      <WidgetFrame
        title={title}
        state="forbidden"
        forbiddenText="Bộ lọc này gắn với dự án bạn không có quyền xem"
      />
    );
  }
  if (!jql) {
    return <WidgetFrame title={title} state="empty" emptyText="Chưa đặt câu lọc JQL cho ô này" />;
  }

  const state = queryWidgetState(q, (d) => d.length === 0);
  return (
    <WidgetFrame
      title={title}
      state={state}
      error={q.error}
      onRetry={() => void q.refetch()}
      emptyText="Không có công việc nào khớp bộ lọc"
      to={{ href: `/filters?jql=${encodeURIComponent(jql)}`, label: 'Mở bộ lọc →' }}
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
              <StatusPill status={issue.status} />
            </Link>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  );
}
