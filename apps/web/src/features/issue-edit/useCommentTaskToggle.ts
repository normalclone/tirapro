import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CommentDto } from '@tirapro/types';
import { apiErrorCode } from '@/features/issues/moveIssue';
import { apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useUpdateComment } from './api';
import { toggleWithRetry } from './taskToggleRetry';
import { planToggle } from './useTaskToggle';

/**
 * Tick một ô `- [ ]` trong bình luận của MÌNH và lưu (OCC theo `version`). Như tick ở mô tả: đọc bản mới nhất từ
 * cache, gặp VERSION_CONFLICT thì nạp lại danh sách bình luận rồi áp lại một lần (`expectText` chặn tick nhầm).
 * Khoá trong lúc đang gửi để bấm đôi không tự gây 409 với chính mình.
 */
export function useCommentTaskToggle(issueId: string) {
  const qc = useQueryClient();
  const update = useUpdateComment(issueId, { silent: true });
  const busy = useRef(false);
  return async (
    commentId: string,
    index: number,
    checked: boolean,
    itemText: string,
  ): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    const queryKey = keys.issues.comments(issueId);
    try {
      await toggleWithRetry({
        read: () => {
          const c = qc.getQueryData<CommentDto[]>(queryKey)?.find((x) => x.id === commentId);
          return c ? { text: c.body, version: c.version } : undefined;
        },
        plan: (text) => planToggle(text, index, checked, itemText),
        write: (body, version) => update.mutateAsync({ id: commentId, body, version }),
        reload: () => qc.refetchQueries({ queryKey, exact: true }),
        isConflict: (e) => apiErrorCode(e) === 'VERSION_CONFLICT',
        onMissing: () => toast.error('Chưa tải xong bình luận — thử tick lại sau giây lát.'),
        onMismatch: () =>
          toast.error('Nội dung bình luận vừa thay đổi — hãy kiểm tra lại rồi tick lại.'),
        onError: (e) => toast.error(apiErrorMessage(e)),
      });
    } finally {
      busy.current = false;
    }
  };
}
