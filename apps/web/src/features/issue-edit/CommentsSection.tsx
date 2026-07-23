import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { CommentDto, IssueDto } from '@tirapro/types';
import { useAddComment, useComments } from '@/features/issues/api';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { useAuth } from '@/stores/auth';
import { Avatar } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/api';
import { MarkdownEditor, MarkdownView } from './DescriptionEditor';
import { useDeleteComment, useUpdateComment } from './api';

/**
 * Danh sách + soạn bình luận cho issue. Bình luận lưu dạng Markdown → soạn/sửa bằng MarkdownEditor
 * (nhiều dòng, ⌘/Ctrl+Enter để gửi). Tác giả của bình luận có thể Sửa / Xoá.
 */
export function CommentsSection({ issue }: { issue: IssueDto }) {
  const currentUser = useAuth((s) => s.user);
  const { data: comments } = useComments(issue.id);
  const addComment = useAddComment(issue.id);
  const [draft, setDraft] = useState('');

  async function submit() {
    const body = draft.trim();
    if (!body) return;
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
            canEdit={!!currentUser && c.author?.id === currentUser.id}
          />
        ))}
        {comments?.length === 0 && <p className="text-sm text-faint">Chưa có bình luận.</p>}
      </div>

      <div className="mt-3 space-y-2">
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          onSubmit={() => void submit()}
          rows={3}
          placeholder="Viết bình luận… (Markdown · ⌘/Ctrl+Enter để gửi)"
        />
        <div className="flex items-center gap-2">
          <span className="mr-auto text-xs text-faint">⌘/Ctrl+Enter để gửi</span>
          <Button
            size="sm"
            loading={addComment.isPending}
            disabled={!draft.trim()}
            onClick={() => void submit()}
          >
            Gửi
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  issueId,
  canEdit,
}: {
  comment: CommentDto;
  issueId: string;
  canEdit: boolean;
}) {
  const update = useUpdateComment(issueId);
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
      toast.success('Đã xoá bình luận');
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
            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
            {comment.isEdited ? ' · đã sửa' : ''}
          </span>
        </p>

        {editing ? (
          <div className="mt-1.5 space-y-2">
            <MarkdownEditor
              value={body}
              onChange={setBody}
              onSubmit={() => void save()}
              onCancel={() => { setBody(comment.body); setEditing(false); }}
              autoFocus
              rows={3}
            />
            <div className="flex items-center gap-2">
              <span className="mr-auto text-xs text-faint">⌘/Ctrl+Enter để lưu · Esc huỷ</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setBody(comment.body); setEditing(false); }}
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
              <MarkdownView text={comment.body} />
            </div>
            {canEdit && (
              <div className="mt-1 flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="text-muted transition-colors hover:text-ink"
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
        description="Bình luận sẽ bị gỡ khỏi issue."
        confirmLabel="Xoá bình luận"
        loading={remove.isPending}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
