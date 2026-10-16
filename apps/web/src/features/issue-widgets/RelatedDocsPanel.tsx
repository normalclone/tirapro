import { FileText, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { useIssueDocs, useCreateWikiPage } from '@/features/wiki/api';
import { useCanIn } from '@/features/projects/permissions';
import { apiErrorMessage } from '@/lib/api';

/**
 * Khối "Tài liệu liên quan" của công việc: các trang wiki có nhắc mã công việc này (bấm mở đúng trang),
 * và nút viết tài liệu mới cho công việc (chỉ người có `wiki:manage` ở dự án). Không có tài liệu và không có
 * quyền tạo → ẩn hẳn, không để khối rỗng vô nghĩa.
 */
export function RelatedDocsPanel({
  issue,
}: {
  issue: Pick<IssueDto, 'id' | 'key' | 'summary' | 'projectId'>;
}) {
  const docs = useIssueDocs(issue.id);
  const canWrite = useCanIn(issue.projectId)('wiki:manage');
  const create = useCreateWikiPage();
  const navigate = useNavigate();

  const list = docs.data ?? [];
  if (docs.isPending || docs.isError) return null;
  if (list.length === 0 && !canWrite) return null;

  async function write() {
    try {
      const page = await create.mutateAsync({
        title: `${issue.key} — ${issue.summary}`.slice(0, 200),
        body: `Công việc liên quan: ${issue.key}`,
        projectId: issue.projectId,
      });
      navigate(`/wiki?page=${page.id}&edit=1`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
          <FileText className="h-4 w-4" aria-hidden /> Tài liệu liên quan
          {list.length > 0 ? ` (${list.length})` : ''}
        </p>
        {canWrite && (
          <Button
            size="sm"
            variant="secondary"
            loading={create.isPending}
            onClick={() => void write()}
          >
            <Plus className="h-4 w-4" /> Viết tài liệu cho công việc này
          </Button>
        )}
      </div>
      {list.length > 0 ? (
        <ul className="space-y-1.5">
          {list.map((d) => (
            <li key={d.id}>
              <Link
                to={`/wiki?page=${d.id}`}
                className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ink">{d.title}</span>
                <span className="shrink-0 text-xs text-faint">{d.projectKey ?? 'Chung'}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">Chưa có tài liệu nào nhắc tới công việc này.</p>
      )}
    </div>
  );
}
