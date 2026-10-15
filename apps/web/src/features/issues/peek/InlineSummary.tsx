import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { Input } from '@/components/ui/Input';
import { useCanEditIssue } from '@/features/projects/permissions';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUpdateIssue } from '../api';

/** Tiêu đề sửa tại chỗ: Enter/rời ô lưu, Esc huỷ (và chặn Esc nổi lên để panel không đóng theo). */
export function InlineSummary({ issue }: { issue: IssueDto }) {
  const update = useUpdateIssue(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(issue.summary);
  const cancelled = useRef(false);
  const saving = useRef(false); // Enter rồi blur khi request còn bay → không gửi lần 2 với version cũ

  function start() {
    cancelled.current = false;
    setValue(issue.summary);
    setEditing(true);
  }

  async function save() {
    if (cancelled.current || saving.current) return;
    const next = value.trim();
    if (!next || next === issue.summary) {
      setEditing(false);
      return;
    }
    saving.current = true;
    try {
      await update.mutateAsync({
        id: issue.id,
        key: issue.key,
        patch: { summary: next },
        version: issue.version,
      });
      setEditing(false);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      saving.current = false;
    }
  }

  if (editing) {
    return (
      <Input
        autoFocus
        aria-label="Tiêu đề công việc"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape') {
            e.preventDefault(); // báo cho panel/thanh chọn hàng loạt: Esc này đã dùng để huỷ sửa
            cancelled.current = true;
            setEditing(false);
          }
        }}
        className="h-9 text-lg font-semibold tracking-tight"
      />
    );
  }
  return (
    <h2
      className={cn(
        '-mx-1 min-w-0 flex-1 rounded px-1 text-lg font-semibold leading-snug tracking-tight text-ink-strong',
        canEdit && 'cursor-text hover:bg-surface-2',
      )}
      onClick={canEdit ? start : undefined}
      title={canEdit ? 'Bấm để sửa tiêu đề' : undefined}
    >
      {issue.summary}
    </h2>
  );
}
