import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentDto, IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { invalidateIssue, optimisticPatchIssue, rollbackIssue, scalarIssuePatch, writeIssue } from '@/lib/optimistic';
import { statusPatch, type TransitionVars } from '@/features/board/api';

export interface DevLinkItem {
  id: string;
  type: string;
  state: string | null;
  externalId: string;
  title: string | null;
  url: string;
  branch: string | null;
  authorName: string | null;
  mergedAt: string | null;
  repository?: { name: string; url: string } | null;
  createdAt: string;
}

/** Liên kết code (commit/PR/branch) của issue — cho dev panel. */
export function useDevLinks(issueId: string | undefined) {
  return useQuery({
    queryKey: keys.issues.devLinks(issueId ?? ''),
    queryFn: async () => (await api.get<DevLinkItem[]>(`/issues/${issueId}/dev-links`)).data,
    enabled: !!issueId,
  });
}

/**
 * Danh sách issue của MỘT project — cache duy nhất `keys.issues.byProject(pid)`,
 * Board / Backlog / Gantt / Tree / chi tiết issue đều đọc chung và `useProjectRealtime` vá vào đây.
 */
export function useProjectIssues(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.issues.byProject(projectId ?? ''),
    queryFn: async () =>
      (await api.get<ListResponse<IssueDto>>(`/issues?projectId=${projectId}&limit=200`)).data.data,
    enabled: !!projectId,
  });
}

export function useIssue(key: string | null) {
  return useQuery({
    queryKey: keys.issues.byKey(key ?? ''),
    queryFn: async () => (await api.get<IssueDto>(`/issues/${key}`)).data,
    enabled: !!key,
  });
}

export function useComments(issueId: string | undefined) {
  return useQuery({
    queryKey: keys.issues.comments(issueId ?? ''),
    queryFn: async () => (await api.get<CommentDto[]>(`/issues/${issueId}/comments`)).data,
    enabled: !!issueId,
  });
}

export function useAddComment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<CommentDto>(`/issues/${issueId}/comments`, { body, bodyFormat: 'MARKDOWN' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.issues.comments(issueId) }),
  });
}

export function useUpdateIssue(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; key: string; patch: Record<string, unknown>; version: number }) =>
      api.patch<IssueDto>(`/issues/${v.id}`, { ...v.patch, version: v.version }),
    onMutate: (v) => optimisticPatchIssue(qc, projectId, v.id, scalarIssuePatch(v.patch), v.key),
    onSuccess: (res) => {
      // Ghi bản THẬT (version mới) vào cả chi tiết lẫn danh sách → sửa inline liên tiếp không bị 409 OCC.
      writeIssue(qc, projectId, res.data);
    },
    onError: (_e, v, snap) => {
      rollbackIssue(qc, snap);
      invalidateIssue(qc, projectId, v.key);
    },
  });
}

export function useTransitionDetail(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TransitionVars) =>
      api.post(`/issues/${v.id}/transition`, { toStatusId: v.toStatusId, version: v.version }),
    onMutate: (v) => optimisticPatchIssue(qc, projectId, v.id, statusPatch(v), v.key),
    onError: (_e, _v, snap) => rollbackIssue(qc, snap),
    // Chuyển trạng thái có thể đổi resolution/resolvedAt → luôn nạp lại bản thật (hẹp: issue này + danh sách project).
    onSettled: (_r, _e, v, snap) => invalidateIssue(qc, projectId, snap?.issueKey ?? v.key),
  });
}
