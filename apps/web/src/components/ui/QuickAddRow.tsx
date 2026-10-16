import { useMemo, useRef, useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useProjectMeta } from '@/features/ai/api';
import { useProjectSprints } from '@/features/backlog/api';
import { useWorkspaceUsers } from '@/features/issue-edit/api';
import { useCreateIssue, type CreateIssueInput } from '@/features/issues/create-api';
import {
  buildQuickAddInput,
  isEpicType,
  pickDefaultType,
  typeRef,
} from '@/features/issues/quickAdd';
import { setQuickAddTypeKey, useQuickAddTypeKey } from '@/features/issues/quickAddType';
import { TokenTitleInput } from '@/features/issues/TokenTitleInput';
import type { TokenCtx } from '@/features/issues/titleTokens';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { IssueTypeIcon } from './IssueTypeIcon';
import { SearchSelect } from './SearchSelect';

/**
 * Hàng "thêm nhanh" issue — gõ tiêu đề + Enter là tạo ngay (keyboard-first, UX §3).
 * Hiểu token `!ưu-tiên ~điểm @người ^hạn #sprint` (cùng parser với hộp tạo việc), chọn được loại việc
 * (nhớ lần chọn), giữ focus để gõ việc kế tiếp.
 * Dùng ở đáy mỗi cột Board và mỗi khu Backlog/Sprint.
 *
 *  projectKey — để lấy issue type + ưu tiên (meta).
 *  projectId  — dự án đích của issue mới.
 *  extra      — trường phụ áp cho issue mới (statusId cho cột board, sprintId cho sprint, epicId khi đang lọc epic).
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
  // Người dùng/sprint chỉ để gợi ý token → tải khi ô được focus lần đầu (Board nhiều cột không bắn nhiều request).
  const [touched, setTouched] = useState(false);
  const pickedKey = useQuickAddTypeKey();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { data: meta } = useProjectMeta(projectKey || undefined);
  const { data: users } = useWorkspaceUsers({ enabled: touched });
  const { data: sprints } = useProjectSprints(touched ? projectId : undefined);
  const create = useCreateIssue(projectId);

  const types = useMemo(() => meta?.issueTypes ?? [], [meta]);
  const typeId = pickDefaultType(types, pickedKey);
  const selectable = types.filter((t) => !t.isSubtask); // sub-task cần việc cha → không liệt kê
  const ctx = useMemo<TokenCtx>(
    () => ({ priorities: meta?.priorities ?? [], users: users ?? [], sprints: sprints ?? [] }),
    [meta, users, sprints],
  );

  function submit() {
    if (create.isPending || !summary.trim()) return;
    if (!typeId) {
      toast.info('Đang tải danh sách loại việc — thử lại sau giây lát.');
      return;
    }
    const picked = types.find((t) => t.id === typeId);
    const built = buildQuickAddInput(summary, ctx, {
      projectId,
      typeId,
      typeIsEpic: !!picked && isEpicType(picked),
      extra,
    });
    if (!built) {
      toast.info('Cần có tiêu đề — hãy gõ tên việc trước các token (! ~ @ ^ #) rồi nhấn Enter.');
      return;
    }
    const epicDropped = !!picked && isEpicType(picked) && !!extra?.epicId;
    create.mutate(built.input, {
      onSuccess: (issue) => {
        setSummary('');
        inputRef.current?.focus();
        if (epicDropped)
          toast.info(
            `Đã tạo epic ${issue.key}. Epic không nằm trong epic khác nên không hiện khi đang lọc theo epic — chọn “Tất cả việc” để thấy.`,
          );
        if (built.unmatched.length > 0)
          toast.info(`${built.unmatched.join(', ')} chưa nhận ra nên được giữ trong tiêu đề`);
      },
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
  }

  return (
    <div
      className={cn('flex items-start gap-1.5', compact ? 'px-2 pb-2' : 'px-2 py-1.5', className)}
      onFocusCapture={() => setTouched(true)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && summary && !e.defaultPrevented) {
          e.stopPropagation();
          setSummary('');
        }
      }}
    >
      <span className="grid h-7 w-5 shrink-0 place-items-center text-faint">
        {create.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Plus className="h-3.5 w-3.5" aria-hidden />
        )}
      </span>
      {selectable.length > 0 && (
        <SearchSelect
          value={typeId}
          onChange={(id) => {
            const t = types.find((x) => x.id === id);
            setQuickAddTypeKey(t ? typeRef(t) : null);
            inputRef.current?.focus();
          }}
          options={selectable.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
          ariaLabel="Loại việc khi thêm nhanh"
          searchPlaceholder="Tìm loại việc…"
          hideChevron
          className="h-7 w-7 shrink-0 justify-center border-transparent bg-transparent px-0 hover:bg-surface-2"
          renderTrigger={(sel) => {
            const t = types.find((x) => x.id === sel?.value);
            return t ? (
              <span className="flex justify-center">
                <IssueTypeIcon type={t} />
              </span>
            ) : null;
          }}
        />
      )}
      <div
        className="min-w-0 flex-1"
        title="Gõ !ưu-tiên ~điểm @người ^hạn #sprint ngay trong tiêu đề"
      >
        <TokenTitleInput
          bare
          value={summary}
          onChange={setSummary}
          ctx={ctx}
          placeholder={placeholder}
          ariaLabel="Thêm nhanh việc mới"
          inputRef={inputRef}
          onEnter={submit}
        />
      </div>
    </div>
  );
}
