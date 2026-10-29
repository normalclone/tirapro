import { useParams } from 'react-router-dom';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '@/features/projects/api';
import { useCan } from '@/features/projects/permissions';
import { Button } from '@/components/ui/Button';
import { DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { IssueTypeBadge } from '@/components/ui/IssueTypeBadge';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiErrorMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/dateFormat';
import { useRestoreIssue, useTrash, type TrashItem } from './api';

/** Thùng rác của dự án — việc đã xoá, khôi phục 1 cú bấm. Chỉ người có `issue:delete` (quản trị dự án). */
export function TrashPage() {
  const { key = '' } = useParams();
  const { data: project } = useProject(key);
  const projectId = project?.id;
  const allowed = useCan(projectId)('issue:delete');
  const trash = useTrash(allowed ? projectId : undefined);
  const restore = useRestoreIssue(projectId ?? '');

  function onRestore(item: TrashItem) {
    restore.mutate(item.id, {
      onSuccess: () => toast.success(`Đã khôi phục ${item.key}`, { duration: 2500 }),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <PageFrame size="full">
        <PageHeader
          variant="tab"
          title={
            <span className="inline-flex items-baseline gap-2">
              Thùng rác
              {!!trash.data?.length && (
                <span className="tabular text-sm font-normal text-muted">{trash.data.length}</span>
              )}
            </span>
          }
        />
        <div>
          {!projectId ? (
            <Skeleton className="h-16 w-full" />
          ) : !allowed ? (
            <EmptyState
              icon={<Trash2 className="h-8 w-8" />}
              title="Chỉ quản trị dự án xem được Thùng rác"
              description="Nếu bạn lỡ xoá một công việc, hãy nhờ quản trị dự án khôi phục."
            />
          ) : trash.isError ? (
            <QueryError error={trash.error} onRetry={() => trash.refetch()} />
          ) : trash.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
              <DelayedSpinner />
            </div>
          ) : !trash.data || trash.data.length === 0 ? (
            <EmptyState
              icon={<Trash2 className="h-8 w-8" />}
              title="Thùng rác trống — việc bị xoá sẽ nằm đây để khôi phục"
              description="Việc đã xoá được giữ lại và chưa tự dọn."
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {trash.data.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
                >
                  <span className="sm:w-28 sm:shrink-0">
                    <IssueTypeBadge name={item.type.name} color={item.type.color} />
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted sm:w-24">{item.key}</span>
                  <span
                    className="min-w-0 flex-1 basis-40 truncate text-sm text-ink-strong"
                    title={item.summary}
                  >
                    {item.summary}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    Xoá {fmtDateTime(item.deletedAt)}
                    {item.deletedBy ? ` bởi ${item.deletedBy.displayName}` : ''}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onRestore(item)}
                    disabled={restore.isPending}
                    title="Đưa công việc này trở lại dự án"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Khôi phục
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageFrame>
    </div>
  );
}
