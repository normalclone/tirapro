import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { setTaskChecked } from '@tirapro/shared';
import type { IssueDto } from '@tirapro/types';
import { useUpdateIssue } from '@/features/issues/api';
import { apiErrorCode } from '@/features/issues/moveIssue';
import { apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { toggleWithRetry } from './taskToggleRetry';

type TaskField = 'description' | 'acceptanceCriteria';

/** Văn bản mới sau khi tick/bỏ tick mục thứ `index`; `null` nếu mục ở vị trí đó không còn là `itemText`. */
export const planToggle = (text: string, index: number, checked: boolean, itemText: string) =>
  setTaskChecked(text, index, checked, itemText);

/**
 * Tick một ô `- [ ]` trong trường Markdown của công việc và lưu ngay (OCC). Đọc văn bản + version MỚI NHẤT
 * từ cache (đã gồm bản vá lạc quan) nên hai cú tick liên tiếp không dùng version cũ. Gặp VERSION_CONFLICT:
 * nạp lại đúng công việc đó rồi áp lại cú tick MỘT lần (`expectText` chặn tick nhầm mục nếu văn bản đã đổi).
 */
export function useTaskToggle(projectId: string | undefined, field: TaskField) {
  const qc = useQueryClient();
  const patch = useUpdateIssue(projectId, { silent: true });
  return (
    issue: Pick<IssueDto, 'id' | 'key'>,
    index: number,
    checked: boolean,
    itemText: string,
  ): Promise<void> => {
    const queryKey = keys.issues.byKey(issue.key);
    return toggleWithRetry({
      read: () => {
        const cur = qc.getQueryData<IssueDto>(queryKey);
        const text = cur?.[field];
        return cur && text ? { text, version: cur.version } : undefined;
      },
      plan: (text) => planToggle(text, index, checked, itemText),
      write: (next, version) =>
        patch.mutateAsync({ id: issue.id, key: issue.key, patch: { [field]: next }, version }),
      // useUpdateIssue.onError đã hoàn tác + invalidate; chờ bản mới về cache rồi thử lại.
      reload: () => qc.refetchQueries({ queryKey, exact: true }),
      isConflict: (e) => apiErrorCode(e) === 'VERSION_CONFLICT',
      onMissing: () => toast.error('Chưa tải xong công việc — thử tick lại sau giây lát.'),
      onMismatch: () =>
        toast.error('Nội dung vừa được người khác thay đổi — hãy kiểm tra lại rồi tick lại.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  };
}
