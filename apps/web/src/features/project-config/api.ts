import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth-token';

/** ---- Components ---- */

export type VersionStatus = 'UNRELEASED' | 'RELEASED' | 'ARCHIVED';

export interface Component {
  id: string;
  name: string;
  description?: string | null;
  leadId?: string | null;
}

export interface ComponentCreateInput {
  name: string;
  description?: string;
  leadId?: string;
}

export interface ComponentUpdateInput {
  name?: string;
  description?: string;
}

export interface Version {
  id: string;
  name: string;
  description?: string | null;
  status: VersionStatus;
  startDate?: string | null;
  releaseDate?: string | null;
}

export interface VersionCreateInput {
  name: string;
  description?: string;
  status?: VersionStatus;
  startDate?: string;
  releaseDate?: string;
}

export interface VersionUpdateInput {
  name?: string;
  description?: string;
  status?: VersionStatus;
  releaseDate?: string;
}

/** ---- Labels ---- */

export interface Label {
  id: string;
  name: string;
  color?: string | null;
}

export interface LabelCreateInput {
  name: string;
  color?: string;
}

export interface LabelUpdateInput {
  name?: string;
  color?: string;
}

/** ---- Import ---- */

export type ImportSource = 'CSV' | 'JSON';
export type ImportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface ImportResult {
  jobId: string;
  created: number;
  failed: number;
  total: number;
  errors: string[];
}

export interface ImportJob {
  id: string;
  source: ImportSource;
  status: ImportStatus;
  totalItems: number;
  processedItems: number;
  result?: ImportResult | null;
  createdAt: string;
  completedAt?: string | null;
}

export const componentsKey = (projectId: string) => ['components', projectId] as const;
export const versionsKey = (projectId: string) => ['versions', projectId] as const;
export const labelsKey = (projectId: string) => ['labels', projectId] as const;
export const importJobsKey = () => ['import-jobs'] as const;

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

export function useComponents(projectId?: string) {
  return useQuery({
    queryKey: componentsKey(projectId ?? ''),
    queryFn: async () =>
      (await api.get<Component[]>(`/projects/${projectId}/components`)).data,
    enabled: !!projectId,
  });
}

export function useCreateComponent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ComponentCreateInput) =>
      api.post<Component>(`/projects/${projectId}/components`, input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: componentsKey(projectId) });
    },
  });
}

export function useUpdateComponent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ComponentUpdateInput }) =>
      api.patch<Component>(`/components/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: componentsKey(projectId) });
    },
  });
}

export function useDeleteComponent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/components/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: componentsKey(projectId) });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

export function useVersions(projectId?: string) {
  return useQuery({
    queryKey: versionsKey(projectId ?? ''),
    queryFn: async () =>
      (await api.get<Version[]>(`/projects/${projectId}/versions`)).data,
    enabled: !!projectId,
  });
}

export function useCreateVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VersionCreateInput) =>
      api.post<Version>(`/projects/${projectId}/versions`, input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionsKey(projectId) });
    },
  });
}

export function useUpdateVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: VersionUpdateInput }) =>
      api.patch<Version>(`/versions/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionsKey(projectId) });
    },
  });
}

export function useDeleteVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/versions/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionsKey(projectId) });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export function useLabels(projectId?: string) {
  return useQuery({
    queryKey: labelsKey(projectId ?? ''),
    queryFn: async () => (await api.get<Label[]>(`/projects/${projectId}/labels`)).data,
    enabled: !!projectId,
  });
}

export function useCreateLabel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LabelCreateInput) =>
      api.post<Label>(`/projects/${projectId}/labels`, input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: labelsKey(projectId) });
    },
  });
}

export function useUpdateLabel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LabelUpdateInput }) =>
      api.patch<Label>(`/labels/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: labelsKey(projectId) });
    },
  });
}

export function useDeleteLabel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/labels/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: labelsKey(projectId) });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Import / Export                                                     */
/* ------------------------------------------------------------------ */

export function useImportJobs() {
  return useQuery({
    queryKey: importJobsKey(),
    queryFn: async () => (await api.get<ImportJob[]>(`/import/jobs`)).data,
  });
}

/** Sau khi import xong: làm mới jobs + issue trên board + components/labels. */
function invalidateAfterImport(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  void qc.invalidateQueries({ queryKey: importJobsKey() });
  void qc.invalidateQueries({ queryKey: ['board-issues', projectId] });
  void qc.invalidateQueries({ queryKey: componentsKey(projectId) });
  void qc.invalidateQueries({ queryKey: labelsKey(projectId) });
}

export function useImportCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, csv }: { projectId: string; csv: string }) =>
      api.post<ImportResult>(`/import/csv`, { projectId, csv }).then((r) => r.data),
    onSuccess: (_data, { projectId }) => invalidateAfterImport(qc, projectId),
  });
}

export function useImportJson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: unknown }) =>
      api.post<ImportResult>(`/import/json`, { projectId, data }).then((r) => r.data),
    onSuccess: (_data, { projectId }) => invalidateAfterImport(qc, projectId),
  });
}

/**
 * Tải file export JSON của dự án. Dùng fetch thuần (không qua axios `api`) vì
 * endpoint trả về file đính kèm; tự đính kèm Bearer token rồi kích hoạt tải về.
 */
export async function downloadProjectExport(projectId: string): Promise<void> {
  const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
  const token = getAccessToken();
  const res = await fetch(`${baseUrl}/export/project/${projectId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Tải dữ liệu thất bại (HTTP ${res.status}).`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : `project-${projectId}-export.json`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
