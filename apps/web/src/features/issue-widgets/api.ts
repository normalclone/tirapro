import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

// ---- Types (local, no `any`) ----
export interface WatchState {
  watching: boolean;
}

export interface LinkType {
  id: string;
  name: string;
  outwardName: string;
  inwardName: string;
}

interface LinkedIssue {
  id: string;
  key: string;
  summary: string;
  status: Pick<IssueDto['status'], 'name' | 'category'>;
}

export interface IssueLink {
  id: string;
  direction: 'outward' | 'inward';
  relationName: string;
  linkTypeId: string;
  otherIssue: LinkedIssue;
}

// ---- Query keys ----

// ---- Watch ----
export function useWatchState(issueId: string) {
  return useQuery({
    queryKey: keys.issues.watch(issueId),
    queryFn: issueId
      ? async () => (await api.get<WatchState>(`/issues/${issueId}/watch`)).data
      : skipToken,
  });
}

export interface WatcherUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Người đang theo dõi công việc (GET /issues/:id/watchers, PROJECT_VIEW) — cache 60s, mutation watch làm mới. */
export function useWatchers(issueId: string, enabled = true) {
  return useQuery({
    queryKey: keys.issues.watchers(issueId),
    queryFn:
      issueId && enabled
        ? async () =>
            (
              await api.get<{ watchers: WatcherUser[]; isWatching: boolean }>(
                `/issues/${issueId}/watchers`,
              )
            ).data
        : skipToken,
    staleTime: 60_000,
  });
}

/** Toggle: gọi POST nếu muốn theo dõi, DELETE nếu muốn bỏ. `watching` = trạng thái hiện tại. */
export function useToggleWatch(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (watching: boolean) => {
      const res = watching
        ? await api.delete<WatchState>(`/issues/${issueId}/watch`)
        : await api.post<WatchState>(`/issues/${issueId}/watch`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.issues.watch(issueId) });
      void qc.invalidateQueries({ queryKey: keys.issues.watchers(issueId) });
    },
  });
}

// ---- Links ----
export function useIssueLinks(issueId: string) {
  return useQuery({
    queryKey: keys.issues.links(issueId),
    queryFn: issueId
      ? async () => (await api.get<IssueLink[]>(`/issues/${issueId}/links`)).data
      : skipToken,
  });
}

export function useLinkTypes() {
  return useQuery({
    queryKey: keys.issues.linkTypes,
    queryFn: async () => (await api.get<LinkType[]>('/link-types')).data,
  });
}

export function useCreateLink(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      targetIssueId: string;
      linkTypeId: string;
      /** 'inward' = công việc đang xem là phía ĐÍCH ("is blocked by"); mặc định 'outward'. */
      direction?: 'outward' | 'inward';
    }) => (await api.post<IssueLink>(`/issues/${issueId}/links`, v)).data,
    onSuccess: (_res, v) => {
      void qc.invalidateQueries({ queryKey: keys.issues.links(issueId) });
      // Đầu kia thấy liên kết theo chiều ngược lại → nạp lại danh sách liên kết của nó nếu đang có trong cache.
      void qc.invalidateQueries({ queryKey: keys.issues.links(v.targetIssueId) });
    },
  });
}

export function useDeleteLink(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      await api.delete(`/links/${linkId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.issues.links(issueId) });
    },
  });
}
