import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { setTaskChecked } from '@tirapro/shared';
import type { IssueDto } from '@tirapro/types';
import { useUpdateIssue } from '@/features/issues/api';
import { apiErrorCode } from '@/features/issues/moveIssue';
import { apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

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
  return async (
    issue: Pick<IssueDto, 'id' | 'key'>,
    index: number,
    checked: boolean,
    itemText: string,
  ): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = qc.getQueryData<IssueDto>(keys.issues.byKey(issue.key));
      const src = (cur as Partial<Record<TaskField, string | null>> | undefined)?.[field];
      if (!cur || !src) return;
      const next = planToggle(src, index, checked, itemText);
      if (next === null) {
        toast.error('Nội dung vừa được người khác thay đổi — hãy kiểm tra lại rồi tick lại.');
        return;
      }
      try {
        await patch.mutateAsync({
          id: issue.id,
          key: issue.key,
          patch: { [field]: next },
          version: cur.version,
        });
        return;
      } catch (e) {
        if (apiErrorCode(e) !== 'VERSION_CONFLICT' || attempt === 1) {
          toast.error(apiErrorMessage(e));
          return;
        }
        // useUpdateIssue.onError đã hoàn tác + invalidate; chờ bản mới về cache rồi thử lại.
        await qc.refetchQueries({ queryKey: keys.issues.byKey(issue.key), exact: true });
      }
    }
  };
}
