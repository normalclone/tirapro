import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListTree } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { byPriorityThenStatus } from '@/lib/issueOrder';
import { subtreeProgress } from '@/lib/issueTree';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { categoryColor } from '@/lib/statusColor';
import { useProjectIssues } from '@/features/backlog/api';

/**
 * Task con của 1 issue (con trực tiếp) + tiến độ subtree. Việc đặt task cha nằm ở
 * dải thuộc tính; breadcrumb hiển thị task cha — panel này chỉ hiển thị task con.
 */
export function IssueRelations({ issue }: { issue: IssueDto }) {
  const navigate = useNavigate();
  const { data: issues = [] } = useProjectIssues(issue.projectId);

  const children = useMemo(
    () => issues.filter((i) => i.parentId === issue.id).slice().sort(byPriorityThenStatus),
    [issues, issue.id],
  );
  const progress = useMemo(() => subtreeProgress(issues, issue.id), [issues, issue.id]);

  // Chỉ hiển thị mục Task con khi thực sự có task con.
  if (children.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <ListTree className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-sm font-medium text-ink-strong">Task con ({children.length})</h2>
        {progress.total > 0 && (
          <span className="ml-auto tabular text-xs text-muted">{progress.pct}% hoàn thành</span>
        )}
      </div>

      <div className="space-y-2 p-4">
        {progress.total > 0 && <TaskProgress progress={progress} className="pb-0.5" />}
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {children.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => navigate(`/issue/${c.key}`)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: categoryColor(c.status.category) }}
                  title={c.status.name}
                  aria-hidden
                />
                <span className="shrink-0 font-mono text-xs text-muted">{c.key}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
