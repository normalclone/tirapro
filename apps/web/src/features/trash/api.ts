import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

export interface TrashItem {
  id: string;
  key: string;
  summary: string;
  type: { name: string; color: string | null };
  deletedAt: string;
  deletedBy: { id: string; displayName: string } | null;
}

/** Việc đã xoá của dự án (chỉ người có `issue:delete`). */
export function useTrash(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.trash(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<TrashItem[]>(`/projects/${projectId}/trash`)).data
      : skipToken,
  });
}

/** Khôi phục một việc từ Thùng rác → quay lại danh sách việc của dự án. */
export function useRestoreIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (issueId: string) =>
      (await api.post<IssueDto>(`/projects/${projectId}/trash/${issueId}/restore`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.trash(projectId) });
      void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
    },
  });
}
