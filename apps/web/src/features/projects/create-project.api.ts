import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectDto, ProjectType } from '@tirapro/types';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryClient';

export interface CreateProjectInput {
  name: string;
  key: string;
  type: ProjectType;
  description?: string | null;
}

/** Tạo dự án mới; invalidate danh sách dự án khi thành công. */
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateProjectInput) =>
      api.post<ProjectDto>('/projects', v).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}
