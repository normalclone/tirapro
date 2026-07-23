import { useMutation, useQuery } from '@tanstack/react-query';
import type { ProjectDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { qk, queryClient } from '@/lib/queryClient';

export function useProjects() {
  return useQuery({
    queryKey: qk.projects,
    queryFn: async () => (await api.get<ProjectDto[]>('/projects')).data,
  });
}

export function useProject(key: string) {
  return useQuery({
    queryKey: qk.project(key),
    queryFn: async () => (await api.get<ProjectDto>(`/projects/${key}`)).data,
    enabled: !!key,
  });
}

function invalidateProject(key: string) {
  void queryClient.invalidateQueries({ queryKey: qk.project(key) });
  void queryClient.invalidateQueries({ queryKey: qk.projects });
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
