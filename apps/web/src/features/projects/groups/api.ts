import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectDto, ProjectProgramRefDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { usePrograms } from '@/features/portfolio/api';

/**
 * Đặt lại TOÀN BỘ nhóm của MỘT dự án (`PUT /projects/:id/programs`; cần `project:admin` của chính dự án đó). Ghi kết quả
 * máy chủ vào mọi cache danh sách dự án rồi làm mới danh mục nhóm (số dự án của nhóm đổi theo).
 */
export function useSetProjectPrograms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, programIds }: { projectId: string; programIds: string[] }) =>
      (
        await api.put<{ projectId: string; programs: ProjectProgramRefDto[] }>(
          `/projects/${projectId}/programs`,
          { programIds },
        )
      ).data,
    onSuccess: ({ projectId, programs }) => {
      qc.setQueriesData<ProjectDto[]>({ queryKey: keys.projects.all }, (list) =>
        Array.isArray(list) ? list.map((p) => (p.id === projectId ? { ...p, programs } : p)) : list,
      );
      void qc.invalidateQueries({ queryKey: keys.projects.all });
      void qc.invalidateQueries({ queryKey: keys.programs.all });
    },
  });
}

/** Danh mục nhóm (id/tên/màu) cho popover "Nhóm" và cây "Theo nhóm"; nhóm chưa có dự án cũng có mặt. */
export function useProgramRefs(): ProjectProgramRefDto[] {
  const { data } = usePrograms();
  return useMemo(() => (data ?? []).map(({ id, name, color }) => ({ id, name, color })), [data]);
}
