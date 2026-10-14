import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentDto, IssueDto, UserDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Thành viên của không gian làm việc — dùng cho dropdown người làm (assignee). */
export function useWorkspaceUsers() {
  return useQuery({
    queryKey: keys.users.workspace,
    queryFn: async () => (await api.get<UserDto[]>('/users')).data,
    staleTime: 5 * 60_000,
  });
}

/**
 * Patch một field của issue (OCC: luôn gửi `version`).
 * Sau khi thành công, làm mới issue + board để nhận `version` mới.
 */
export function usePatchIssue(key: string, projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown>; version: number }) =>
      api.patch<IssueDto>(`/issues/${v.id}`, { ...v.patch, version: v.version }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.issues.byKey(key) });
      if (projectId) void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
    },
  });
}

/** Xoá mềm một issue. */
export function useDeleteIssue() {
  return useMutation({
    mutationFn: (id: string) => api.delete(`/issues/${id}`),
  });
}

/** Sửa nội dung bình luận (OCC: gửi `version`). */
export function useUpdateComment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: string; version: number }) =>
      api.patch<CommentDto>(`/comments/${v.id}`, { body: v.body, version: v.version }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.issues.comments(issueId) }),
  });
}

/** Xoá bình luận. */
export function useDeleteComment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/comments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.issues.comments(issueId) }),
  });
}
