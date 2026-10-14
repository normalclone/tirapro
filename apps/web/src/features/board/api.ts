import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardDto, IssueDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { invalidateIssue, optimisticPatchIssue, rollbackIssue } from '@/lib/optimistic';

export function useBoards(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.boards.byProject(projectId ?? ''),
    queryFn: projectId ? async () => (await api.get<BoardDto[]>(`/boards?projectId=${projectId}`)).data : skipToken,
  });
}

/** Biến của mutation chuyển trạng thái (dùng chung board + trang chi tiết). */
export interface TransitionVars {
  id: string;
  toStatusId: string;
  version: number;
  /** Tên cột/trạng thái đích — để card hiện đúng tên ngay khi vá lạc quan. */
  statusName?: string;
  /** Mã issue — không bắt buộc, thiếu thì lấy từ cache danh sách. */
  key?: string;
}

/** Vá lạc quan trạng thái của issue (giữ category cũ; bản thật về sau sẽ thay). */
export const statusPatch = (v: TransitionVars) => (i: IssueDto): Partial<IssueDto> => ({
  status: { ...i.status, id: v.toStatusId, name: v.statusName ?? i.status.name },
});

/** Optimistic transition: di chuyển card sang cột mới NGAY, rollback nếu lỗi. */
export function useTransitionIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TransitionVars) =>
      api.post<IssueDto>(`/issues/${v.id}/transition`, { toStatusId: v.toStatusId, version: v.version }).then((r) => r.data),
    onMutate: (v) => optimisticPatchIssue(qc, projectId, v.id, statusPatch(v), v.key),
    onError: (_e, _v, snap) => rollbackIssue(qc, snap),
    onSettled: (_r, _e, v, snap) => invalidateIssue(qc, projectId, snap?.issueKey ?? v.key),
  });
}
