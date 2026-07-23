import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { issueKey } from '@/features/issues/api';
import { boardIssuesKey } from '@/features/board/api';

/** Nhãn / thành phần / phiên bản ở cấp dự án — cho picker trong chi tiết issue. */
export interface ProjectLabel {
  id: string;
  name: string;
  color: string | null;
}
export interface ProjectComponent {
  id: string;
  name: string;
}
export interface ProjectVersion {
  id: string;
  name: string;
  status: string;
}

/** Loại liên kết phiên bản với issue. */
export type VersionType = 'FIX' | 'AFFECTS';

export const projectLabelsKey = (projectId: string) => ['project-labels', projectId] as const;
export const projectComponentsKey = (projectId: string) => ['project-components', projectId] as const;
export const projectVersionsKey = (projectId: string) => ['project-versions', projectId] as const;

/* ------------------------------- Queries -------------------------------- */

export function useProjectLabels(projectId: string | undefined) {
  return useQuery({
    queryKey: projectLabelsKey(projectId ?? ''),
    queryFn: async () => (await api.get<ProjectLabel[]>(`/projects/${projectId}/labels`)).data,
    enabled: !!projectId,
  });
}

export function useProjectComponents(projectId: string | undefined) {
  return useQuery({
    queryKey: projectComponentsKey(projectId ?? ''),
    queryFn: async () => (await api.get<ProjectComponent[]>(`/projects/${projectId}/components`)).data,
    enabled: !!projectId,
  });
}

export function useProjectVersions(projectId: string | undefined) {
  return useQuery({
    queryKey: projectVersionsKey(projectId ?? ''),
    queryFn: async () => (await api.get<ProjectVersion[]>(`/projects/${projectId}/versions`)).data,
    enabled: !!projectId,
  });
}

/* ------------------------------- Labels --------------------------------- */

/**
 * Gắn/gỡ nhãn cho issue. Sau khi thành công, làm mới query issue (để `issue.labels`
 * cập nhật) và danh sách issue trên board.
 */
export function useToggleLabel(issueId: string, issueKeyStr: string, projectId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: issueKey(issueKeyStr) });
    if (projectId) void qc.invalidateQueries({ queryKey: boardIssuesKey(projectId) });
  };
  const attach = useMutation({
    mutationFn: (labelId: string) => api.post(`/issues/${issueId}/labels`, { labelId }),
    onSuccess: invalidate,
  });
  const detach = useMutation({
    mutationFn: (labelId: string) => api.delete(`/issues/${issueId}/labels/${labelId}`),
    onSuccess: invalidate,
  });
  return { attach, detach };
}

/* ----------------------------- Components -------------------------------- */

export function useToggleComponent(issueId: string) {
  const attach = useMutation({
    mutationFn: (componentId: string) => api.post(`/issues/${issueId}/components`, { componentId }),
  });
  const detach = useMutation({
    mutationFn: (componentId: string) => api.delete(`/issues/${issueId}/components/${componentId}`),
  });
  return { attach, detach };
}

/* ------------------------------ Versions --------------------------------- */

export function useToggleVersion(issueId: string) {
  const attach = useMutation({
    mutationFn: (v: { versionId: string; type?: VersionType }) =>
      api.post(`/issues/${issueId}/versions`, { versionId: v.versionId, type: v.type ?? 'FIX' }),
  });
  const detach = useMutation({
    mutationFn: (v: { versionId: string; type?: VersionType }) =>
      api.delete(`/issues/${issueId}/versions/${v.versionId}/${v.type ?? 'FIX'}`),
  });
  return { attach, detach };
}
