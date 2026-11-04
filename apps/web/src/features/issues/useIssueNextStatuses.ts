import { useMemo } from 'react';
import type { IssueDto } from '@tirapro/types';
import { useProjectScheme } from '@/features/workflow-settings/schemeApi';
import { useWorkflows } from '@/features/workflow-settings/api';
import { useResumeSuggestion } from './api';
import { resolveIssueFlow, withSuggestedFirst, type NextStatus } from './nextStatuses';

/**
 * Bước chuyển trạng thái của MỘT việc, theo quy trình của LOẠI việc đó (khớp máy chủ) — dùng chung cho nút trên trang, xem nhanh,
 * menu, Cmd+K. Đang ở Pending thì trạng thái trước khi tạm dừng đứng đầu và nổi bật. `mismatch`: trạng thái hiện tại nằm ngoài
 * quy trình của loại (dữ liệu lệch) → `nextStatuses` là các trạng thái của quy trình đúng, nơi gọi hiện một ô "Chuyển về quy
 * trình đúng" thay vì dãy nút.
 */
export function useIssueNextStatuses(
  issue: Pick<IssueDto, 'id' | 'projectId' | 'type' | 'status'> | undefined,
): { nextStatuses: NextStatus[]; mismatch: boolean; workflowName: string | null } {
  const { data: workflows } = useWorkflows();
  // Cấu hình theo loại việc của dự án (cache 1 phút, đổi cấu hình thì bị làm mới cùng nhóm `workflows`).
  const { data: scheme } = useProjectScheme(issue?.projectId, { staleTime: 60_000 });
  const resumeId = useResumeSuggestion(issue);
  const typeWorkflowId = scheme?.items.find((i) => i.issueTypeId === issue?.type.id)?.workflowId;
  const statusId = issue?.status.id;
  return useMemo(() => {
    const flow = resolveIssueFlow(workflows, typeWorkflowId, statusId);
    return {
      nextStatuses: withSuggestedFirst(flow.next, flow.mismatch ? undefined : resumeId),
      mismatch: flow.mismatch,
      workflowName: flow.typeWorkflow?.name ?? null,
    };
  }, [workflows, typeWorkflowId, statusId, resumeId]);
}
