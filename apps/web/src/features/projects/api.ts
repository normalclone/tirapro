import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import type { ProjectDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { keys } from '@/lib/queryKeys';

/** Danh sách dự án; mặc định ẩn dự án đã lưu trữ (`includeArchived` để hiện — cache riêng, cùng tiền tố `all`). */
export function useProjects(includeArchived = false) {
  return useQuery({
    queryKey: includeArchived ? keys.projects.withArchived : keys.projects.all,
    queryFn: async () =>
      (
        await api.get<ProjectDto[]>('/projects', {
          params: includeArchived ? { includeArchived: true } : undefined,
        })
      ).data,
  });
}

export function useProject(key: string) {
  return useQuery({
    queryKey: keys.projects.byKey(key),
    queryFn: key ? async () => (await api.get<ProjectDto>(`/projects/${key}`)).data : skipToken,
  });
}

function invalidateProject(key: string) {
  void queryClient.invalidateQueries({ queryKey: keys.projects.byKey(key) });
  void queryClient.invalidateQueries({ queryKey: keys.projects.all });
}

/** Tải ảnh đại diện project (cần quyền quản trị project). */
export function useUploadProjectAvatar(key: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return (await api.post<ProjectDto>(`/projects/${key}/avatar`, fd)).data;
    },
    onSuccess: () => invalidateProject(key),
  });
}

/** Gỡ ảnh đại diện project. */
export function useRemoveProjectAvatar(key: string) {
  return useMutation({
    mutationFn: async () => (await api.delete(`/projects/${key}/avatar`)).data,
    onSuccess: () => invalidateProject(key),
  });
}

/** Sửa thông tin dự án (cần quyền quản trị dự án). Mã dự án không đổi được. */
export interface ProjectPatch {
  name?: string;
  description?: string | null;
  leadId?: string | null;
  defaultAssigneeMode?: 'UNASSIGNED' | 'PROJECT_LEAD';
}

export function useUpdateProject(key: string, projectId: string | undefined) {
  return useMutation({
    mutationFn: async (patch: ProjectPatch) =>
      (await api.patch<ProjectDto>(`/projects/${projectId}`, patch)).data,
    onSuccess: () => invalidateProject(key),
  });
}

/** Lưu trữ / khôi phục dự án. Dự án đã lưu trữ chỉ đọc nên các cache việc/sprint cũng được làm mới. */
export function useArchiveProject(key: string, projectId: string | undefined) {
  return useMutation({
    mutationFn: async (archive: boolean) =>
      (await api.post<ProjectDto>(`/projects/${projectId}/${archive ? 'archive' : 'unarchive'}`))
        .data,
    onSuccess: () => invalidateProject(key),
  });
}
