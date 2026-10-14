import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto, SprintDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

export function useProjectSprints(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.sprints.byProject(projectId ?? ''),
    queryFn: async () => (await api.get<SprintDto[]>(`/sprints?projectId=${projectId}`)).data,
    enabled: !!projectId,
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

/**
 * Di chuyển issue sang sprint khác (hoặc backlog khi sprintId === null).
 * Optimistic: cập nhật danh sách issues ngay, rollback nếu lỗi (vd OCC conflict).
 */
export function useMoveToSprint(projectId: string) {
  const qc = useQueryClient();
  const issuesKey = keys.issues.byProject(projectId);
  return useMutation({
    mutationFn: (v: { id: string; sprintId: string | null; version: number }) =>
      api
        .patch<IssueDto>(`/issues/${v.id}`, { sprintId: v.sprintId, version: v.version })
        .then((r) => r.data),
    onMutate: async (v: { id: string; sprintId: string | null; version: number }) => {
      await qc.cancelQueries({ queryKey: issuesKey });
      const prev = qc.getQueryData<IssueDto[]>(issuesKey);
      qc.setQueryData<IssueDto[]>(issuesKey, (old) =>
        (old ?? []).map((i) =>
          i.id === v.id ? { ...i, sprintId: v.sprintId, version: i.version + 1 } : i,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(issuesKey, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: issuesKey });
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
    },
  });
}
