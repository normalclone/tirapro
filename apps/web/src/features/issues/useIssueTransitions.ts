import { useMemo } from 'react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useWorkflows } from '@/features/workflow-settings/api';
import { apiErrorMessage } from '@/lib/api';
import { useTransitionDetail } from './api';
import { computeNextStatuses } from './nextStatuses';
import { transitionToastOptions } from './statusUndo';

/**
 * Bước chuyển trạng thái kế tiếp của một công việc + hàm đổi trạng thái (toast kèm Hoàn tác khi hợp lệ).
 * Dùng chung cho trang chi tiết và panel xem nhanh để hai nơi không lệch hành vi.
 */
export function useIssueTransitions(issue: IssueDto | undefined) {
  const { data: workflows } = useWorkflows();
  const transition = useTransitionDetail(issue?.projectId ?? '');

  // Chỉ các trạng thái ở BƯỚC KẾ TIẾP — chuyển tiếp hợp lệ từ trạng thái hiện tại theo workflow.
  const currentStatusId = issue?.status.id;
  const nextStatuses = useMemo(
    () => computeNextStatuses(workflows, currentStatusId),
    [workflows, currentStatusId],
  );

  function changeStatus(toStatusId: string) {
    if (!issue || toStatusId === issue.status.id) return;
    const toName = nextStatuses.find((s) => s.id === toStatusId)?.name;
    const from = { statusId: issue.status.id, statusName: issue.status.name };
    transition.mutate(
      { id: issue.id, key: issue.key, toStatusId, version: issue.version, statusName: toName },
      {
        onSuccess: (updated) =>
          toast.success(
            toName ? `Đã chuyển sang “${toName}”` : 'Đã đổi trạng thái',
            transitionToastOptions({ workflows, from, toStatusId, updated, transition }),
          ),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return { nextStatuses, changeStatus, isPending: transition.isPending };
}
