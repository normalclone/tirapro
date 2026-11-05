import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectSubTeamDto, ProjectTeamLinkDto } from '@tirapro/types';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Team của tổ chức đã gắn vào dự án — `GET /projects/:id/teams`. */
export function useProjectTeamLinks(projectId?: string) {
  return useQuery({
    queryKey: keys.projectTeams.links(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<ProjectTeamLinkDto[]>(`/projects/${projectId}/teams`)).data
      : skipToken,
  });
}

/** Gắn / gỡ team đổi thành viên và vai trò của nhiều người: nạp lại danh sách thành viên + quyền dự án + mọi dữ liệu team. */
function useAfterTeamLinkChange(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.projectTeams.root });
    void qc.invalidateQueries({ queryKey: keys.members.project(projectId) });
    void qc.invalidateQueries({ queryKey: keys.projects.permissions(projectId) });
    void qc.invalidateQueries({ queryKey: keys.teams.all });
  };
}

/** Gắn team (hoặc đổi vai trò của team đã gắn): `PUT /projects/:id/teams/:teamId`. */
export function useLinkProjectTeam(projectId: string) {
  const after = useAfterTeamLinkChange(projectId);
  return useMutation({
    mutationFn: ({ teamId, roleIds }: { teamId: string; roleIds: string[] }) =>
      api
        .put<ProjectTeamLinkDto[]>(`/projects/${projectId}/teams/${teamId}`, { roleIds })
        .then((r) => r.data),
    onSuccess: after,
  });
}

export function useUnlinkProjectTeam(projectId: string) {
  const after = useAfterTeamLinkChange(projectId);
  return useMutation({
    mutationFn: (teamId: string) =>
      api
        .delete<ProjectTeamLinkDto[]>(`/projects/${projectId}/teams/${teamId}`)
        .then((r) => r.data),
    onSuccess: after,
  });
}

/** Team riêng trong dự án (kèm thành viên) — `GET /projects/:id/sub-teams`. Bảng việc dùng cùng dữ liệu để lọc/chia hàng theo team. */
export function useProjectSubTeams(projectId?: string) {
  return useQuery({
    queryKey: keys.projectTeams.subTeams(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<ProjectSubTeamDto[]>(`/projects/${projectId}/sub-teams`)).data
      : skipToken,
    staleTime: 30_000,
  });
}

export interface SubTeamInput {
  name?: string;
  color?: string | null;
  memberIds?: string[];
}

export function useCreateSubTeam(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubTeamInput & { name: string }) =>
      api.post<ProjectSubTeamDto>(`/projects/${projectId}/sub-teams`, input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.projectTeams.subTeams(projectId) }),
  });
}

export function useUpdateSubTeam(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: SubTeamInput & { id: string }) =>
      api
        .patch<ProjectSubTeamDto>(`/projects/${projectId}/sub-teams/${id}`, input)
        .then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.projectTeams.subTeams(projectId) }),
  });
}

export function useDeleteSubTeam(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<Ack>(`/projects/${projectId}/sub-teams/${id}`).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.projectTeams.subTeams(projectId) }),
  });
}
