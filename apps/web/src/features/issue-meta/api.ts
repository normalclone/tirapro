import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { patchIssueSets } from './patchIssueSets';
import { withComponent, withoutComponent, withVersion, withoutVersion } from './issueSets';

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
    queryFn: projectId
      ? async () => (await api.get<ProjectLabel[]>(`/projects/${projectId}/labels`)).data
      : skipToken,
  });
}

export function useProjectComponents(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.projectMeta.components(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<ProjectComponent[]>(`/projects/${projectId}/components`)).data
      : skipToken,
  });
}

export function useProjectVersions(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.projectMeta.versions(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<ProjectVersion[]>(`/projects/${projectId}/versions`)).data
      : skipToken,
  });
}

/* ------------------------------- Labels --------------------------------- */

/**
 * Gắn/gỡ nhãn cho issue. Sau khi thành công, làm mới query issue (để `issue.labels`
 * cập nhật) và danh sách issue trên board.
 */
export function useToggleLabel(
  issueId: string,
  issueKeyStr: string,
  projectId: string | undefined,
) {
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

/* ------------------- Thành phần & phiên bản của MỘT công việc ------------------- */

function useSyncIssue(issue: IssueDto) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.issues.byKey(issue.key) });
    void qc.invalidateQueries({ queryKey: keys.issues.byProject(issue.projectId) });
    // Lịch sử có thêm dòng gắn/bỏ.
    void qc.invalidateQueries({ queryKey: keys.issues.activity(issue.id) });
  };
}

interface UndoCtx {
  undo: () => void;
}

/** Huỷ fetch đang bay để kết quả cũ không đè bản vá lạc quan (các cache chứa việc này). */
async function cancelIssueQueries(qc: ReturnType<typeof useQueryClient>, issue: IssueDto) {
  await Promise.all([
    qc.cancelQueries({ queryKey: keys.issues.byKey(issue.key) }),
    qc.cancelQueries({ queryKey: keys.issues.byProject(issue.projectId) }),
  ]);
}

export function useToggleComponent(issue: IssueDto) {
  const qc = useQueryClient();
  const sync = useSyncIssue(issue);
  const attach = useMutation({
    mutationFn: (v: { componentId: string; name: string }) =>
      api.post(`/issues/${issue.id}/components`, { componentId: v.componentId }),
    onMutate: async (v): Promise<UndoCtx> => {
      await cancelIssueQueries(qc, issue);
      const ref = { id: v.componentId, name: v.name };
      return {
        undo: patchIssueSets(
          qc,
          issue,
          (i) => ({ components: withComponent(i.components, ref), fixVersions: i.fixVersions }),
          (i) => ({
            components: withoutComponent(i.components, v.componentId),
            fixVersions: i.fixVersions,
          }),
        ),
      };
    },
    onError: (_e, _v, ctx) => ctx?.undo(),
    onSettled: sync,
  });
  const detach = useMutation({
    mutationFn: (componentId: string) =>
      api.delete(`/issues/${issue.id}/components/${componentId}`),
    onMutate: async (componentId): Promise<UndoCtx> => {
      await cancelIssueQueries(qc, issue);
      const ref = issue.components.find((c) => c.id === componentId);
      return {
        undo: patchIssueSets(
          qc,
          issue,
          (i) => ({
            components: withoutComponent(i.components, componentId),
            fixVersions: i.fixVersions,
          }),
          (i) => ({
            components: ref ? withComponent(i.components, ref) : i.components,
            fixVersions: i.fixVersions,
          }),
        ),
      };
    },
    onError: (_e, _v, ctx) => ctx?.undo(),
    onSettled: sync,
  });
  return { attach, detach };
}

export function useToggleVersion(issue: IssueDto) {
  const qc = useQueryClient();
  const sync = useSyncIssue(issue);
  const attach = useMutation({
    mutationFn: (v: { versionId: string; name: string; type: VersionType }) =>
      api.post(`/issues/${issue.id}/versions`, { versionId: v.versionId, type: v.type }),
    onMutate: async (v): Promise<UndoCtx> => {
      await cancelIssueQueries(qc, issue);
      const ref = { id: v.versionId, name: v.name, type: v.type };
      return {
        undo: patchIssueSets(
          qc,
          issue,
          (i) => ({ components: i.components, fixVersions: withVersion(i.fixVersions, ref) }),
          (i) => ({
            components: i.components,
            fixVersions: withoutVersion(i.fixVersions, v.versionId, v.type),
          }),
        ),
      };
    },
    onError: (_e, _v, ctx) => ctx?.undo(),
    onSettled: sync,
  });
  const detach = useMutation({
    mutationFn: (v: { versionId: string; type: VersionType }) =>
      api.delete(`/issues/${issue.id}/versions/${v.versionId}/${v.type}`),
    onMutate: async (v): Promise<UndoCtx> => {
      await cancelIssueQueries(qc, issue);
      const ref = issue.fixVersions.find((x) => x.id === v.versionId && x.type === v.type);
      return {
        undo: patchIssueSets(
          qc,
          issue,
          (i) => ({
            components: i.components,
            fixVersions: withoutVersion(i.fixVersions, v.versionId, v.type),
          }),
          (i) => ({
            components: i.components,
            fixVersions: ref ? withVersion(i.fixVersions, ref) : i.fixVersions,
          }),
        ),
      };
    },
    onError: (_e, _v, ctx) => ctx?.undo(),
    onSettled: sync,
  });
  return { attach, detach };
}
