import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useUpdateIssue } from '@/features/issues/api';
import { useCanEditIssue } from '@/features/projects/permissions';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/api';
import { stripPlaceholders } from './pasteImage';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownView } from './MarkdownView';
import { usePastedImageUploader } from '@/features/attachments/api';
import { useAssigneeOptions } from './useAssigneeOptions';
import { useTaskToggle } from './useTaskToggle';

/**
 * Mô tả công việc: xem (render Markdown, dạng label) → bấm để sửa bằng MarkdownEditor.
 * Lưu bằng nút hoặc ⌘/Ctrl+Enter, Esc để huỷ.
 */
export function IssueDescription({ issue }: { issue: IssueDto }) {
  const patch = useUpdateIssue(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  const people = useAssigneeOptions(issue.projectId);
  const toggleTask = useTaskToggle(issue.projectId, 'description');
  const pasteImages = usePastedImageUploader(issue.id, 'description');
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState(issue.description ?? '');

  useEffect(() => {
    if (!editing) setDraft(issue.description ?? '');
  }, [issue.description, editing]);

  function start() {
    setDraft(issue.description ?? '');
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(issue.description ?? '');
  }
  function save() {
    if (uploading) return; // ảnh dán còn đang tải: chưa lưu (tránh lưu chữ giữ chỗ)
    const clean = stripPlaceholders(draft);
    const next = clean.trim() === '' ? null : clean;
    setEditing(false);
    if (next === (issue.description ?? null)) return;
    patch.mutate(
      { id: issue.id, key: issue.key, patch: { description: next }, version: issue.version },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  if (!canEdit) {
    return issue.description ? (
      <div className="rounded-md border border-border bg-surface p-3">
        <MarkdownView text={issue.description} />
      </div>
    ) : (
      <p className="text-sm text-faint">Chưa có mô tả.</p>
    );
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          onSubmit={save}
          onCancel={cancel}
          autoFocus
          rows={8}
          mentionPeople={people}
          onPasteImages={pasteImages}
          onBusyChange={setUploading}
        />
        <div className="flex items-center gap-2">
          <span className="mr-auto text-xs text-faint">
            Viết được Markdown · ⌘/Ctrl+Enter để lưu · Esc để huỷ
          </span>
          <Button size="sm" variant="ghost" onClick={cancel}>
            Huỷ
          </Button>
          <Button size="sm" onClick={save} loading={patch.isPending} disabled={uploading}>
            Lưu
          </Button>
        </div>
      </div>
    );
  }

  if (!issue.description) {
    return (
      <button
        type="button"
        onClick={start}
        className="w-full rounded-md border border-dashed border-border px-3 py-2.5 text-left text-sm text-faint transition-colors hover:border-primary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        Chưa có mô tả — bấm để viết rõ việc cần làm.
      </button>
    );
  }

  return (
    <div
      onClick={start}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // Enter trên ô tick/liên kết bên trong không vào chế độ sửa
        if (e.key === 'Enter') {
          e.preventDefault();
          start();
        }
      }}
      title="Bấm để sửa mô tả"
      className="cursor-text rounded-md border border-border bg-surface p-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <MarkdownView
        text={issue.description}
        onToggleTask={(i, checked, text) => void toggleTask(issue, i, checked, text)}
      />
    </div>
  );
}
