import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BulkUpdateIssuesResult, IssueDto, SprintDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { invalidateIssue, optimisticPatchIssue, rollbackIssue, writeIssue } from '@/lib/optimistic';

export function useProjectSprints(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.sprints.byProject(projectId ?? ''),
    queryFn: projectId ? async () => (await api.get<SprintDto[]>(`/sprints?projectId=${projectId}`)).data : skipToken,
  });
}

/** Invalidate cả sprints + issues của project sau mỗi mutation. */
function useInvalidateBacklog(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
    void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
  };
}

export function useCreateSprint(projectId: string) {
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    mutationFn: (v: { name: string; goal?: string; startDate?: string; endDate?: string }) =>
      api.post<SprintDto>('/sprints', { projectId, ...v }).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useStartSprint(projectId: string) {
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    mutationFn: (sprintId: string) =>
      api.post<SprintDto>(`/sprints/${sprintId}/start`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useCompleteSprint(projectId: string) {
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    mutationFn: (sprintId: string) =>
      api.post<SprintDto>(`/sprints/${sprintId}/complete`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

/** Phần thay đổi áp cho cả lô issue (khớp `bulkUpdateIssuesSchema` ở máy chủ). */
export interface BulkIssuePatch {
  statusId?: string;
  assigneeId?: string | null;
  priorityId?: string | null;
  sprintId?: string | null;
}

/**
 * Sửa hàng loạt trong MỘT request. Kết quả: `updated` (kèm version mới của máy chủ — dùng cho "Hoàn tác")
 * và `conflicts` (việc bị người khác sửa trước, không làm hỏng cả lô).
 */
export function useBulkUpdateIssues(projectId: string) {
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    // Im lặng: trang tự gom lỗi/conflict thành một toast tổng kết (khớp cơ chế `meta.silent` của MutationCache).
    meta: { silent: true },
    mutationFn: (v: { items: Array<{ id: string; version: number }>; patch: BulkIssuePatch }) =>
      api.patch<BulkUpdateIssuesResult>('/issues/bulk', { projectId, ...v }).then((r) => r.data),
    onSettled: invalidate,
  });
}

/**
 * Di chuyển issue sang sprint khác (hoặc backlog khi sprintId === null).
 * Optimistic: cập nhật danh sách issues ngay, rollback nếu lỗi (vd OCC conflict).
 */
/** `opts.silent`: tắt toast lỗi chung (gọi hàng loạt tự tổng kết lỗi). */
export function useMoveToSprint(projectId: string, opts?: { silent?: boolean }) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: opts?.silent },
    mutationFn: (v: { id: string; sprintId: string | null; version: number }) =>
      api
        .patch<IssueDto>(`/issues/${v.id}`, { sprintId: v.sprintId, version: v.version })
        .then((r) => r.data),
    onMutate: (v) => optimisticPatchIssue(qc, projectId, v.id, { sprintId: v.sprintId }),
    onSuccess: (issue) => writeIssue(qc, projectId, issue),
    onError: (_e, _v, snap) => {
      rollbackIssue(qc, snap);
      invalidateIssue(qc, projectId, snap?.issueKey);
    },
    // Số issue/điểm của sprint đổi theo → luôn nạp lại danh sách sprint.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
    },
  });
}
