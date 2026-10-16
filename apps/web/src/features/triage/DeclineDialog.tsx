import { useState } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { MarkdownEditor } from '@/features/issue-edit/MarkdownEditor';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { appendReason } from '@/features/issues/transitionKind';
import { DECLINE_QUICK_REASONS, isDeclineReasonValid } from './triageLogic';

/**
 * Từ chối một yêu cầu: BẮT BUỘC có lý do (người gửi cần biết) — lý do được lưu thành bình luận và báo người gửi.
 * Chip câu nhanh chỉ ĐIỀN vào ô (không gửi ngay) để người duyệt còn sửa/bổ sung.
 */
export function DeclineDialog({
  open,
  issueKey,
  projectId,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  issueKey: string;
  projectId: string;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const people = useAssigneeOptions(projectId);
  const valid = isDeclineReasonValid(reason);

  const submit = () => {
    if (loading || !valid) return;
    onConfirm(reason.trim());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title={`Từ chối ${issueKey}`}
      description="Người gửi sẽ nhận được lý do này."
      icon={<X className="h-4 w-4" />}
      size="sm"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Huỷ
          </Button>
          <Button size="sm" variant="danger" onClick={submit} disabled={!valid} loading={loading}>
            Từ chối
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink" id="decline-reason-label">
          Lý do
        </p>
        <MarkdownEditor
          value={reason}
          onChange={(v) => setReason(v.slice(0, 2000))}
          rows={3}
          autoFocus
          mentionPeople={people}
          mentionProjectId={projectId}
          placeholder="Vì sao không nhận yêu cầu này? (gõ @ để nhắc người)"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lý do nhanh">
          {DECLINE_QUICK_REASONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setReason((cur) => appendReason(cur, c))}
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {c}
            </button>
          ))}
        </div>
        <p className="text-xs text-faint">
          {valid
            ? 'Cmd/Ctrl+Enter để từ chối · Esc huỷ'
            : 'Cần ghi lý do (ít nhất 3 ký tự) — hoặc bấm một câu nhanh ở trên.'}
        </p>
      </div>
    </Dialog>
  );
}
