import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentDto, IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

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
    onSuccess: (res, v) => {
      // Ghi lại object trả về (version mới) → sửa inline liên tiếp không bị 409 OCC.
      qc.setQueryData(keys.issues.byKey(v.key), res.data);
      if (projectId) void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
    },
  });
}

export function useTransitionDetail(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; key: string; toStatusId: string; version: number }) =>
      api.post(`/issues/${v.id}/transition`, { toStatusId: v.toStatusId, version: v.version }),
    onSuccess: (_res, _v) => {
      void qc.invalidateQueries({ queryKey: keys.issues.byKey(_v.key) });
      if (projectId) void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
    },
  });
}
