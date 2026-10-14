import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

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


/* ------------------------------- Queries -------------------------------- */

export function useProjectLabels(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.projectMeta.labels(projectId ?? ''),
    queryFn: projectId ? async () => (await api.get<ProjectLabel[]>(`/projects/${projectId}/labels`)).data : skipToken,
  });
}

export function useProjectComponents(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.projectMeta.components(projectId ?? ''),
    queryFn: projectId ? async () => (await api.get<ProjectComponent[]>(`/projects/${projectId}/components`)).data : skipToken,
  });
}

export function useProjectVersions(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.projectMeta.versions(projectId ?? ''),
    queryFn: projectId ? async () => (await api.get<ProjectVersion[]>(`/projects/${projectId}/versions`)).data : skipToken,
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
    void qc.invalidateQueries({ queryKey: keys.issues.byKey(issueKeyStr) });
    if (projectId) void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
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
