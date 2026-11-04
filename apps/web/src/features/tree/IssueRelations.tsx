import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListTree } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { byPriorityThenStatus } from '@/lib/issueOrder';
import { childrenForPanel, epicTaskProgress } from '@/lib/epic';
import { isEpicIssue } from '@/lib/issueRefs';
import { subtreeProgress } from '@/lib/issueTree';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { StatusPill } from '@/components/ui/StatusPill';
import { Avatar } from '@/components/ui/primitives';
import { useProjectIssues } from '@/features/issues/api';

/**
 * Việc con trực tiếp của một công việc + tiến độ cả nhánh. Việc đặt việc cha nằm ở
 * dải thuộc tính; breadcrumb hiển thị task cha — panel này chỉ hiển thị task con.
 */
export function IssueRelations({ issue }: { issue: IssueDto }) {
  const navigate = useNavigate();
  const { data: issues = [] } = useProjectIssues(issue.projectId);

  const children = useMemo(
    () => childrenForPanel(issues, issue).sort(byPriorityThenStatus),
    [issues, issue],
  );
  const isEpic = isEpicIssue(issue);
  // Epic: tiến độ theo đúng tập thành viên đang liệt kê (số việc khớp danh sách, % theo điểm); việc thường: cả nhánh con cháu.
  const progress = useMemo(
    () => (isEpic ? epicTaskProgress(issues, issue.id) : subtreeProgress(issues, issue.id)),
    [issues, issue.id, isEpic],
  );

  // Chỉ hiển thị mục Việc con khi thực sự có việc con.
  if (children.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <ListTree className="h-4 w-4 text-muted" aria-hidden />
        <h2
          className="text-sm font-medium text-ink-strong"
          title={
            isEpic
              ? 'Các công việc thuộc epic này (gắn epic hoặc là việc con trực tiếp).'
              : 'Những việc nhỏ được tách ra từ việc này. Xong hết việc con thì việc cha mới coi là xong.'
          }
        >
          {isEpic ? 'Công việc trong epic' : 'Việc con'} ({children.length})
        </h2>
        {progress.total > 0 && (
          <span className="ml-auto tabular text-xs text-muted">{progress.pct}% hoàn thành</span>
        )}
      </div>

      <div className="space-y-2 p-4">
        {progress.total > 0 && (
          <TaskProgress
            progress={progress}
            className="pb-0.5"
            label={isEpic ? 'Tiến độ epic' : undefined}
          />
        )}
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {children.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => navigate(`/issue/${c.key}`)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <span className="shrink-0 font-mono text-xs text-muted">{c.key}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.summary}</span>
                <StatusPill status={c.status} alwaysShowName className="shrink-0" />
                <span className="w-7 shrink-0 text-right tabular text-xs text-muted" title="Điểm">
                  {c.storyPoints ?? '—'}
                </span>
                {c.assignee ? (
                  <span className="shrink-0" title={`Phụ trách: ${c.assignee.displayName}`}>
                    <Avatar
                      name={c.assignee.displayName}
                      src={c.assignee.avatarUrl}
                      size={20}
                      decorative
                    />
                  </span>
                ) : (
                  <span
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-dashed border-border text-[10px] text-faint"
                    title="Chưa giao"
                    aria-label="Chưa giao"
                  >
                    ?
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
