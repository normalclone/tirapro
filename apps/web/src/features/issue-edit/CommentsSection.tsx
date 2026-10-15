import { useState } from 'react';
import { toast } from 'sonner';
import type { CommentDto, IssueDto } from '@tirapro/types';
import { useAddComment, useComments } from '@/features/issues/api';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { COMMENT_INPUT_ID } from '@/features/command/events';
import { useCanIn } from '@/features/projects/permissions';
import { useAuth } from '@/stores/auth';
import { Avatar } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import type { PersonOption } from '@/components/ui/PeoplePicker';
import { apiErrorMessage } from '@/lib/api';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownView } from './MarkdownView';
import { useAssigneeOptions } from './useAssigneeOptions';
import { useCommentTaskToggle } from './useCommentTaskToggle';
import { useDeleteComment, useUpdateComment } from './api';
import { TypingIndicator } from '@/features/presence/TypingIndicator';
import { useTypingEmitter } from '@/features/presence/usePresence';
import { fmtRelative } from '@/lib/dateFormat';

/**
 * Danh sách + soạn bình luận cho một công việc. Bình luận lưu dạng Markdown → soạn/sửa bằng
 * MarkdownEditor (nhiều dòng, ⌘/Ctrl+Enter để gửi). Người viết có thể Sửa / Xoá bình luận của mình.
 */
export function CommentsSection({ issue }: { issue: IssueDto }) {
  const currentUser = useAuth((s) => s.user);
  const { data: comments } = useComments(issue.id);
  const addComment = useAddComment(issue.id);
  const people = useAssigneeOptions(issue.projectId);
  const can = useCanIn(issue.projectId); // dự án lưu trữ / không có quyền → chỉ đọc
  const canComment = can('comment:create');
  const canEditOwn = can('comment:edit:own');
  const [draft, setDraft] = useState('');
  const { notifyTyping, stopTyping } = useTypingEmitter(issue.id);

  function onDraftChange(value: string) {
    setDraft(value);
    if (value.trim()) notifyTyping();
    else stopTyping();
  }

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    stopTyping();
    try {
      await addComment.mutateAsync(body);
      setDraft('');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-muted">
        Bình luận {comments?.length ? `(${comments.length})` : ''}
      </p>

      <div className="space-y-3">
        {(comments ?? []).map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            issueId={issue.id}
            people={people}
            canEdit={canEditOwn && !!currentUser && c.author?.id === currentUser.id}
          />
        ))}
        {comments?.length === 0 && (
          <p className="text-sm text-faint">
            {canComment
              ? 'Chưa có bình luận nào. Viết vài dòng bên dưới để trao đổi với cả nhóm về việc này.'
              : 'Chưa có bình luận nào.'}
          </p>
        )}
      </div>

      {canComment && (
        <div className="mt-3 space-y-2">
          <MarkdownEditor
            value={draft}
            onChange={onDraftChange}
            onSubmit={() => void submit()}
            rows={3}
            mentionPeople={people}
            textareaId={COMMENT_INPUT_ID}
            placeholder="Viết bình luận… (viết được Markdown · ⌘/Ctrl+Enter để gửi)"
          />
          <TypingIndicator issueId={issue.id} />
          <div className="flex items-center gap-2">
            <span className="mr-auto text-xs text-faint">⌘/Ctrl+Enter để gửi</span>
            <Button
              size="sm"
              loading={addComment.isPending}
              disabled={!draft.trim()}
              onClick={() => void submit()}
            >
              Gửi bình luận
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  issueId,
  people,
  canEdit,
}: {
  comment: CommentDto;
  issueId: string;
  people: PersonOption[];
  canEdit: boolean;
}) {
  const update = useUpdateComment(issueId);
  const toggleTask = useCommentTaskToggle(issueId);
  const remove = useDeleteComment(issueId);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    const next = body.trim();
    if (!next) return;
    if (next === comment.body) {
      setEditing(false);
      return;
    }
    try {
      await update.mutateAsync({ id: comment.id, body: next, version: comment.version });
      setEditing(false);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function onDelete() {
    try {
      await remove.mutateAsync(comment.id);
      setConfirmDelete(false);
      toast.success('Đã xoá bình luận của bạn');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div className="flex gap-2.5">
      <Avatar name={comment.author?.displayName ?? '?'} src={comment.author?.avatarUrl} size={26} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium text-ink-strong">{comment.author?.displayName}</span>{' '}
          <span className="text-xs text-faint">
            {fmtRelative(comment.createdAt)}
            {comment.isEdited ? ' · đã sửa' : ''}
          </span>
        </p>

        {editing ? (
          <div className="mt-1.5 space-y-2">
            <MarkdownEditor
              value={body}
              onChange={setBody}
              onSubmit={() => void save()}
              onCancel={() => {
                setBody(comment.body);
                setEditing(false);
              }}
              autoFocus
              rows={3}
              mentionPeople={people}
            />
            <div className="flex items-center gap-2">
              <span className="mr-auto text-xs text-faint">⌘/Ctrl+Enter để lưu · Esc huỷ</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setBody(comment.body);
                  setEditing(false);
                }}
              >
                Huỷ
              </Button>
              <Button size="sm" loading={update.isPending} onClick={() => void save()}>
                Lưu
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-0.5">
              <MarkdownView
                text={comment.body}
                onToggleTask={
                  canEdit
                    ? (i, checked, text) => void toggleTask(comment.id, i, checked, text)
                    : undefined
                }
              />
            </div>
            {canEdit && (
              <div className="mt-1 flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="text-muted transition-colors hover:text-ink"
                  title="Sửa lại bình luận này"
                  onClick={() => {
                    setBody(comment.body);
                    setEditing(true);
                  }}
                >
                  Sửa
                </button>
                <button
                  type="button"
                  className="text-muted transition-colors hover:text-danger disabled:opacity-50"
                  title="Xoá bình luận này"
                  disabled={remove.isPending}
                  onClick={() => setConfirmDelete(true)}
                >
                  Xoá
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Xoá bình luận này?"
        description="Bình luận sẽ biến mất khỏi công việc và không khôi phục lại được."
        confirmLabel="Xoá bình luận"
        loading={remove.isPending}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
