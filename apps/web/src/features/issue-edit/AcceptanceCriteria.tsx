import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { useUpdateIssue } from '@/features/issues/api';
import { apiErrorCode } from '@/features/issues/moveIssue';
import { useCanEditIssue } from '@/features/projects/permissions';
import { apiErrorMessage } from '@/lib/api';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownView } from './MarkdownView';
import { useAssigneeOptions } from './useAssigneeOptions';
import { useTaskToggle } from './useTaskToggle';

/** Giá trị khởi tạo khi mở editor trên khối rỗng: một ô tick sẵn để gõ tiêu chí đầu tiên. */
const STARTER = '- [ ] ';

/**
 * Khối "Tiêu chí chấp nhận" của công việc (Markdown, mỗi dòng `- [ ]` là một tiêu chí): tick tại chỗ
 * (OCC + thử lại sau 409 như mô tả), hiện tiến độ "2/5 đạt", bấm để sửa. Lưu bằng nút hoặc ⌘/Ctrl+Enter, Esc huỷ.
 * Người gọi quyết định có hiện khối hay không (Story luôn hiện; loại khác chỉ khi đã có nội dung).
 */
export function AcceptanceCriteria({ issue }: { issue: IssueDto }) {
  const patch = useUpdateIssue(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  const people = useAssigneeOptions(issue.projectId);
  const toggleTask = useTaskToggle(issue.projectId, 'acceptanceCriteria');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issue.acceptanceCriteria ?? '');

  useEffect(() => {
    if (!editing) setDraft(issue.acceptanceCriteria ?? '');
  }, [issue.acceptanceCriteria, editing]);

  const text = issue.acceptanceCriteria;
  const progress = issue.acceptanceProgress;

  function start() {
    setDraft(text || STARTER);
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(text ?? '');
  }
  function save() {
    // Chỉ còn ô tick rỗng ("- [ ]") coi như không có tiêu chí.
    const next = draft.trim() === '' || draft.trim() === '- [ ]' ? null : draft;
    setEditing(false);
    if (next === (text ?? null)) return;
    patch.mutate(
      { id: issue.id, key: issue.key, patch: { acceptanceCriteria: next }, version: issue.version },
      {
        // Lỗi/409: KHÔNG mất chữ đang sửa — mở lại editor với đúng nội dung vừa gõ. 409: useUpdateIssue đã nạp lại bản mới
        // (version mới nằm trong `issue`), nên bấm Lưu lần nữa là ghi đè có chủ đích sau khi người dùng đã được báo.
        onError: (e) => {
          setDraft(next ?? '');
          setEditing(true);
          toast.error(
            apiErrorCode(e) === 'VERSION_CONFLICT'
              ? 'Tiêu chí vừa được người khác thay đổi — đã nạp bản mới, chữ bạn đang sửa vẫn còn. Kiểm tra rồi bấm Lưu lại.'
              : apiErrorMessage(e),
          );
        },
      },
    );
  }

  if (!text && !canEdit) return null; // không có gì để xem, không quyền thêm → ẩn

  const header = (
    <div className="mb-1.5 flex items-center gap-3">
      <h2 className="text-sm font-medium text-muted">Tiêu chí chấp nhận</h2>
      {progress && (
        <span className="flex min-w-0 flex-1 items-center gap-2" data-testid="ac-progress">
          <TaskProgress
            progress={{
              total: progress.total,
              done: progress.done,
              inProgress: 0,
              todo: progress.total - progress.done,
              pct: Math.round((progress.done / progress.total) * 100),
            }}
            compact
            className="w-24 shrink-0"
            label="Tiến độ tiêu chí chấp nhận"
            title={`Đã đạt ${progress.done}/${progress.total} tiêu chí`}
          />
          <span
            className={
              progress.done === progress.total
                ? 'tabular text-xs text-success'
                : 'tabular text-xs text-muted'
            }
          >
            {progress.done}/{progress.total} đạt
          </span>
        </span>
      )}
    </div>
  );

  if (editing) {
    return (
      <div>
        {header}
        <div className="space-y-2">
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            onSubmit={save}
            onCancel={cancel}
            autoFocus
            rows={5}
            mentionPeople={people}
            placeholder="Mỗi dòng một tiêu chí, dạng - [ ] Người dùng đăng nhập được bằng email"
          />
          <div className="flex items-center gap-2">
            <span className="mr-auto text-xs text-faint">
              Mỗi dòng một tiêu chí · ⌘/Ctrl+Enter để lưu · Esc để huỷ
            </span>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Huỷ
            </Button>
            <Button size="sm" onClick={save} loading={patch.isPending}>
              Lưu
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!text) {
    return (
      <div>
        {header}
        <button
          type="button"
          onClick={start}
          className="w-full rounded-md border border-dashed border-border px-3 py-2.5 text-left text-sm text-faint transition-colors hover:border-primary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Thêm tiêu chí chấp nhận — mỗi dòng một tiêu chí
        </button>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div
        onClick={canEdit ? start : undefined}
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onKeyDown={(e) => {
          if (!canEdit || e.target !== e.currentTarget) return; // Enter trên ô tick/liên kết bên trong không vào chế độ sửa
          if (e.key === 'Enter') {
            e.preventDefault();
            start();
          }
        }}
        title={canEdit ? 'Bấm để sửa tiêu chí chấp nhận' : undefined}
        className={
          canEdit
            ? 'cursor-text rounded-md border border-border bg-surface p-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'
            : 'rounded-md border border-border bg-surface p-3'
        }
      >
        <MarkdownView
          text={text}
          onToggleTask={
            canEdit
              ? (i, checked, itemText) => void toggleTask(issue, i, checked, itemText)
              : undefined
          }
        />
      </div>
    </div>
  );
}
