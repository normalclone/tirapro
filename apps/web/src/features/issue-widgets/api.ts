import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---- Types (local, no `any`) ----
export interface WatchState {
  watching: boolean;
}

export interface Watcher {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface LinkType {
  id: string;
  name: string;
  outwardName: string;
  inwardName: string;
}

export interface LinkedIssue {
  id: string;
  key: string;
  summary: string;
  status: { name: string; category: string };
}

export interface IssueLink {
  id: string;
  direction: 'outward' | 'inward';
  relationName: string;
  linkTypeId: string;
  otherIssue: LinkedIssue;
}

// ---- Query keys ----
export const watchKey = (issueId: string) => ['issue-watch', issueId] as const;
export const watchersKey = (issueId: string) => ['issue-watchers', issueId] as const;
export const issueLinksKey = (issueId: string) => ['issue-links', issueId] as const;
export const linkTypesKey = () => ['link-types'] as const;

// ---- Watch ----
export function useWatchState(issueId: string) {
  return useQuery({
    queryKey: watchKey(issueId),
    queryFn: async () => (await api.get<WatchState>(`/issues/${issueId}/watch`)).data,
    enabled: !!issueId,
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
      void qc.invalidateQueries({ queryKey: watchKey(issueId) });
      void qc.invalidateQueries({ queryKey: watchersKey(issueId) });
    },
  });
}

// ---- Links ----
export function useIssueLinks(issueId: string) {
  return useQuery({
    queryKey: issueLinksKey(issueId),
    queryFn: async () => (await api.get<IssueLink[]>(`/issues/${issueId}/links`)).data,
    enabled: !!issueId,
  });
}

export function useLinkTypes() {
  return useQuery({
    queryKey: linkTypesKey(),
    queryFn: async () => (await api.get<LinkType[]>('/link-types')).data,
  });
}

export function useCreateLink(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { targetIssueId: string; linkTypeId: string }) =>
      (await api.post<IssueLink>(`/issues/${issueId}/links`, v)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: issueLinksKey(issueId) });
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
      void qc.invalidateQueries({ queryKey: issueLinksKey(issueId) });
    },
  });
}
