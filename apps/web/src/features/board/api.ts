import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardDto, IssueDto } from '@tirapro/types';
import type { ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';

export const boardsKey = (projectId: string) => ['boards', projectId] as const;
export const boardIssuesKey = (projectId: string) => ['board-issues', projectId] as const;

export function useBoards(projectId: string | undefined) {
  return useQuery({
    queryKey: boardsKey(projectId ?? ''),
    queryFn: async () => (await api.get<BoardDto[]>(`/boards?projectId=${projectId}`)).data,
    enabled: !!projectId,
  });
}

export function useBoardIssues(projectId: string | undefined) {
  return useQuery({
    queryKey: boardIssuesKey(projectId ?? ''),
    queryFn: async () => (await api.get<ListResponse<IssueDto>>(`/issues?projectId=${projectId}&limit=200`)).data.data,
    enabled: !!projectId,
  });
}

/** Optimistic transition: di chuyển card sang cột mới NGAY, rollback nếu lỗi. */
export function useTransitionIssue(projectId: string) {
  const qc = useQueryClient();
  const key = boardIssuesKey(projectId);
  return useMutation({
    mutationFn: (v: { id: string; toStatusId: string; version: number }) =>
      api.post(`/issues/${v.id}/transition`, { toStatusId: v.toStatusId, version: v.version }),
    onMutate: async (v: { id: string; toStatusId: string; version: number; statusName?: string }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<IssueDto[]>(key);
      qc.setQueryData<IssueDto[]>(key, (old) =>
        (old ?? []).map((i) =>
          i.id === v.id
            ? { ...i, status: { ...i.status, id: v.toStatusId, name: v.statusName ?? i.status.name }, version: i.version + 1 }
            : i,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: key }); },
  });
}
