import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AiCapabilities,
  AiGenerateIssuesResult,
  AiSuggestResult,
  AiSummaryResult,
} from '@tirapro/shared';
import { api } from '@/lib/api';

export interface ProjectMeta {
  projectId: string;
  issueTypes: { id: string; name: string; key: string | null; color: string | null; iconUrl: string | null; isSubtask: boolean }[];
  priorities: { id: string; name: string; color: string | null; rank: number; isDefault: boolean }[];
}

export const projectMetaKey = (key: string) => ['project-meta', key] as const;

/** Config tạo issue (issue types + priorities) cho quick-add / AI generate. */
export function useProjectMeta(key: string | undefined) {
  return useQuery({
    queryKey: projectMetaKey(key ?? ''),
    queryFn: async () => (await api.get<ProjectMeta>(`/projects/${key}/meta`)).data,
    enabled: !!key,
    staleTime: 5 * 60_000,
  });
}

export const aiCapabilitiesKey = ['ai', 'capabilities'] as const;

/** Khả năng AI hiện tại (Claude hay heuristic). Ít đổi → staleTime dài. */
export function useAiCapabilities() {
  return useQuery({
    queryKey: aiCapabilitiesKey,
    queryFn: async () => (await api.get<AiCapabilities>('/ai/capabilities')).data,
    staleTime: 5 * 60_000,
  });
}

/** Tóm tắt một issue. */
export function useSummarizeIssue() {
  return useMutation({
    mutationFn: (issueId: string) =>
      api.post<AiSummaryResult>(`/ai/issues/${issueId}/summary`).then((r) => r.data),
  });
}

/** Gợi ý ưu tiên & story points cho một issue. */
export function useSuggestIssue() {
  return useMutation({
    mutationFn: (issueId: string) =>
      api.post<AiSuggestResult>(`/ai/issues/${issueId}/suggest`).then((r) => r.data),
  });
}

/** NL → danh sách issue đề xuất (preview). Hook dùng cho màn khác. */
export function useGenerateIssues() {
  return useMutation({
    mutationFn: (v: { projectId: string; text: string }) =>
      api.post<AiGenerateIssuesResult>('/ai/generate-issues', v).then((r) => r.data),
  });
}
