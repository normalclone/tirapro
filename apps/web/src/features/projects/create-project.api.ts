import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectDto, ProjectTemplateKey, ProjectType } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

export interface CreateProjectInput {
  name: string;
  key: string;
  type: ProjectType;
  /** Mẫu dự án; có thì API dùng thay cho `type`. */
  templateKey?: ProjectTemplateKey;
  description?: string | null;
}

/** Tạo dự án mới; invalidate danh sách dự án khi thành công. */
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateProjectInput) => api.post<ProjectDto>('/projects', v).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.projects.all });
    },
  });
}
