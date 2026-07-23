import { useState, type FormEvent } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useProjectMeta } from '@/features/ai/api';
import { useCreateIssue, type CreateIssueInput } from '@/features/issues/create-api';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Hàng "thêm nhanh" issue — gõ tiêu đề + Enter là tạo ngay (keyboard-first, UX §3).
 * Dùng ở đáy mỗi cột Board và mỗi khu Backlog/Sprint.
 *
 *  projectKey — để lấy issue type mặc định (meta).
 *  projectId  — dự án đích của issue mới.
 *  extra      — trường phụ áp cho issue mới (statusId cho cột board, sprintId cho sprint).
 *  placeholder / compact — tinh chỉnh hiển thị theo ngữ cảnh (board vs backlog).
 */
export function QuickAddRow({
  projectKey,
  projectId,
  extra,
  placeholder = '+ Thêm việc… (Enter)',
  compact,
  className,
}: {
  projectKey: string;
  projectId: string;
  extra?: Partial<CreateIssueInput>;
  placeholder?: string;
  compact?: boolean;
  className?: string;
}) {
  const [summary, setSummary] = useState('');
  const { data: meta } = useProjectMeta(projectKey || undefined);
  const create = useCreateIssue(projectId);

  // Loại mặc định = loại đầu tiên không phải sub-task (fallback loại đầu tiên).
  const defaultTypeId =
    meta?.issueTypes.find((t) => !t.isSubtask)?.id ?? meta?.issueTypes[0]?.id ?? '';

  function submit(e: FormEvent) {
    e.preventDefault();
    const s = summary.trim();
    if (!s || !defaultTypeId || create.isPending) return;
    create.mutate(
      { projectId, typeId: defaultTypeId, summary: s, descriptionFormat: 'MARKDOWN', ...extra },
      {
        onSuccess: () => setSummary(''),
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className={cn('flex items-center gap-1.5', compact ? 'px-2 pb-2' : 'px-2 py-1.5', className)}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center text-faint">
        {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
      </span>
      <input
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setSummary(''); }}
        placeholder={placeholder}
        aria-label="Thêm nhanh việc mới"
        disabled={!defaultTypeId || create.isPending}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-faint',
          'focus-visible:outline-none disabled:opacity-60',
        )}
      />
    </form>
  );
}
