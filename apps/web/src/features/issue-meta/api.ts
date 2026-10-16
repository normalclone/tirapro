import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
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

/**
 * Vá `components`/`fixVersions` của một công việc ở cache chi tiết lẫn cache danh sách dự án, rồi trả hàm hoàn lại.
 * Cố ý KHÔNG đổi `version`: máy chủ không tăng version khi gắn/gỡ thành phần-phiên bản (khác `optimisticPatchIssue`),
 * tăng ở FE sẽ làm lệch OCC ở lần sửa kế tiếp.
 */
function patchIssueSets(
  qc: QueryClient,
  issue: IssueDto,
  fn: (i: IssueDto) => Partial<IssueDto>,
): () => void {
  const detailKey = keys.issues.byKey(issue.key);
  const listKey = keys.issues.byProject(issue.projectId);
  const prevDetail = qc.getQueryData<IssueDto>(detailKey);
  const prevListItem = qc.getQueryData<IssueDto[]>(listKey)?.find((i) => i.id === issue.id);
  qc.setQueryData<IssueDto>(detailKey, (o) => (o ? { ...o, ...fn(o) } : o));
  qc.setQueryData<IssueDto[]>(listKey, (l) =>
    l?.map((i) => (i.id === issue.id ? { ...i, ...fn(i) } : i)),
  );
  return () => {
    // Chỉ hoàn lại phần tập hợp của đúng việc này — không đè thay đổi hợp lệ khác (realtime) của việc/việc khác.
    const restore = (i: IssueDto, prev: IssueDto | undefined): IssueDto =>
      prev ? { ...i, components: prev.components, fixVersions: prev.fixVersions } : i;
    qc.setQueryData<IssueDto>(detailKey, (o) => (o ? restore(o, prevDetail) : o));
    qc.setQueryData<IssueDto[]>(listKey, (l) =>
      l?.map((i) => (i.id === issue.id ? restore(i, prevListItem) : i)),
    );
  };
}

function useSyncIssue(issue: IssueDto) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.issues.byKey(issue.key) });
    void qc.invalidateQueries({ queryKey: keys.issues.byProject(issue.projectId) });
  };
}

interface UndoCtx {
  undo: () => void;
}

export function useToggleComponent(issue: IssueDto) {
  const qc = useQueryClient();
  const sync = useSyncIssue(issue);
  const attach = useMutation({
    mutationFn: (v: { componentId: string; name: string }) =>
      api.post(`/issues/${issue.id}/components`, { componentId: v.componentId }),
    onMutate: (v): UndoCtx => ({
      undo: patchIssueSets(qc, issue, (i) => ({
        components: withComponent(i.components, { id: v.componentId, name: v.name }),
      })),
    }),
    onError: (_e, _v, ctx) => ctx?.undo(),
    onSettled: sync,
  });
  const detach = useMutation({
    mutationFn: (componentId: string) =>
      api.delete(`/issues/${issue.id}/components/${componentId}`),
    onMutate: (componentId): UndoCtx => ({
      undo: patchIssueSets(qc, issue, (i) => ({
        components: withoutComponent(i.components, componentId),
      })),
    }),
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
    onMutate: (v): UndoCtx => ({
      undo: patchIssueSets(qc, issue, (i) => ({
        fixVersions: withVersion(i.fixVersions, { id: v.versionId, name: v.name, type: v.type }),
      })),
    }),
    onError: (_e, _v, ctx) => ctx?.undo(),
    onSettled: sync,
  });
  const detach = useMutation({
    mutationFn: (v: { versionId: string; type: VersionType }) =>
      api.delete(`/issues/${issue.id}/versions/${v.versionId}/${v.type}`),
    onMutate: (v): UndoCtx => ({
      undo: patchIssueSets(qc, issue, (i) => ({
        fixVersions: withoutVersion(i.fixVersions, v.versionId, v.type),
      })),
    }),
    onError: (_e, _v, ctx) => ctx?.undo(),
    onSettled: sync,
  });
  return { attach, detach };
}
