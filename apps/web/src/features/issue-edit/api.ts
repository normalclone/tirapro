import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentDto, IssueDto, UserDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useRecents } from '@/stores/recentIssues';

/** Thành viên của không gian làm việc — dùng cho dropdown người làm (assignee). */
export function useWorkspaceUsers(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.users.workspace,
    queryFn: async () => (await api.get<UserDto[]>('/users')).data,
    staleTime: 5 * 60_000,
    enabled: opts?.enabled ?? true,
  });
}

/**
 * Xoá mềm một issue. Thành công thì tự gỡ khỏi cache (danh sách dự án + chi tiết theo mã) —
 * không chỉ trông vào event realtime `issue:deleted` (có thể chậm/lỡ khi mất kết nối).
 */
export function useDeleteIssue() {
  return useRemoveFromCaches((v: IssueRef) => api.delete(`/issues/${v.id}`));
}

/**
 * Người báo thu hồi việc của mình trong 10 phút đầu (không cần quyền xoá chung) — xoá mềm vào Thùng rác.
 * Server quyết điều kiện; cache được dọn giống `useDeleteIssue`.
 */
export function useRetractIssue() {
  return useRemoveFromCaches((v: IssueRef) => api.post(`/issues/${v.id}/retract`));
}

type IssueRef = { id: string; key: string; projectId: string };

function useRemoveFromCaches(call: (v: IssueRef) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (_res, v) => {
      qc.setQueryData<IssueDto[]>(keys.issues.byProject(v.projectId), (old) =>
        old ? old.filter((i) => i.id !== v.id) : undefined,
      );
      qc.removeQueries({ queryKey: keys.issues.byKey(v.key), exact: true });
      useRecents.getState().remove(v.key);
      // Số issue/điểm của sprint đổi theo; việc vừa xoá xuất hiện trong Thùng rác.
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(v.projectId) });
      void qc.invalidateQueries({ queryKey: keys.trash(v.projectId) });
      // Trang chủ (Việc của tôi, Bug tôi báo, tổng quan), hộp phân loại: việc vừa xoá/thu hồi không được còn hiện.
      void qc.invalidateQueries({ queryKey: keys.dashboard.myBugs });
      void qc.invalidateQueries({ queryKey: keys.dashboard.myIssues });
      void qc.invalidateQueries({ queryKey: keys.dashboard.workspaceOverview });
      void qc.invalidateQueries({ queryKey: keys.triage.all });
    },
  });
}

/** Sửa nội dung bình luận (OCC: gửi `version`). */
export function useUpdateComment(issueId: string, opts?: { silent?: boolean }) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: opts?.silent },
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
