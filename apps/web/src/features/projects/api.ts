import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import type { ProjectDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { keys } from '@/lib/queryKeys';

export function useProjects() {
  return useQuery({
    queryKey: keys.projects.all,
    queryFn: async () => (await api.get<ProjectDto[]>('/projects')).data,
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
