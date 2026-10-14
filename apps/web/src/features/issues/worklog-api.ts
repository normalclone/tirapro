import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorklogDto, WorklogListDto } from '@tirapro/types';
import type { AdjustRemainingInput } from '@tirapro/shared';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

export function useWorklogs(issueId: string | undefined) {
  return useQuery({
    queryKey: keys.issues.worklogs(issueId ?? ''),
    queryFn: issueId ? async () => (await api.get<WorklogListDto>(`/issues/${issueId}/worklogs`)).data : skipToken,
  });
}

export interface WorklogInput {
  timeSpent?: string;
  startedAt?: string;
  comment?: string | null;
  adjustRemaining?: AdjustRemainingInput;
}

/** Ghi/sửa/xoá worklog làm đổi `timeSpent`/`remainingEstimate`/`version` của issue → làm mới cả hai cache. */
function useRefresh(issueId: string, issueKey: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.issues.worklogs(issueId) });
    void qc.invalidateQueries({ queryKey: keys.issues.byKey(issueKey) });
    void qc.invalidateQueries({ queryKey: keys.issues.activity(issueId) });
  };
}

export function useAddWorklog(issueId: string, issueKey: string) {
  const refresh = useRefresh(issueId, issueKey);
  return useMutation({
    mutationFn: (input: WorklogInput & { timeSpent: string }) =>
      api.post<WorklogDto>(`/issues/${issueId}/worklogs`, input).then((r) => r.data),
    onSuccess: refresh,
  });
}

export function useUpdateWorklog(issueId: string, issueKey: string) {
  const refresh = useRefresh(issueId, issueKey);
  return useMutation({
    mutationFn: ({ id, ...input }: WorklogInput & { id: string }) =>
      api.patch<WorklogDto>(`/worklogs/${id}`, input).then((r) => r.data),
    onSuccess: refresh,
  });
}

export function useDeleteWorklog(issueId: string, issueKey: string) {
  const refresh = useRefresh(issueId, issueKey);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/worklogs/${id}`).then(() => undefined),
    onSuccess: refresh,
  });
}
