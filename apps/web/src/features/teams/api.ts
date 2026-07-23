import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TeamDto } from '@tirapro/types';
import { api } from '@/lib/api';

/** Khoá cache danh sách nhóm (team) của workspace hiện tại. */
export const teamsKey = ['teams'] as const;

export interface TeamInput {
  name?: string;
  key?: string | null;
  description?: string | null;
  color?: string | null;
  leadId?: string | null;
  memberIds?: string[];
}

/** Danh sách nhóm của workspace hiện tại (kèm lead, thành viên, số đếm). */
export function useTeams() {
  return useQuery({
    queryKey: teamsKey,
    queryFn: async () => (await api.get<TeamDto[]>('/teams')).data,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TeamInput) => api.post<TeamDto>('/teams', input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: teamsKey }),
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: TeamInput & { id: string }) =>
      api.put<TeamDto>(`/teams/${id}`, input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: teamsKey }),
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/teams/${id}`).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: teamsKey }),
  });
}

/** Thêm cả nhóm vào một dự án (mỗi thành viên → project membership với vai trò đã chọn). */
export function useAssignTeamToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId, roleIds }: { id: string; projectId: string; roleIds: string[] }) =>
      api.post<{ success: boolean; added: number }>(`/teams/${id}/assign-project`, { projectId, roleIds }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamsKey });
      void qc.invalidateQueries({ queryKey: ['project-members'] });
    },
  });
}
