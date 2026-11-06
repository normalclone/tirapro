import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PermissionKey } from '@tirapro/types';
import { api, apiErrorMessage, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/stores/auth';
import { useRoles } from './api';

/** Vai trò RIÊNG của một dự án (khác mẫu vai trò dùng chung của tổ chức). */
export interface ProjectRoleDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: string | null;
  permissionKeys: PermissionKey[];
  /** Số người trong dự án đang giữ vai trò này (xoá khi > 0 bị chặn). */
  memberCount: number;
  updatedAt: string;
}

/** Tạo vai trò: "từ mẫu" (`fromTemplateId`, tên mặc định = tên mẫu) hoặc tự chọn quyền (cần `name`). */
export interface CreateProjectRoleInput {
  name?: string;
  fromTemplateId?: string;
  description?: string;
  color?: string;
  permissionKeys?: PermissionKey[];
}

export interface UpdateProjectRoleInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  permissionKeys?: PermissionKey[];
}

/** Vai trò riêng của dự án (`GET /projects/:id/roles`). */
export function useProjectRoles(projectId?: string) {
  return useQuery({
    queryKey: keys.projectRoles.byProject(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<ProjectRoleDto[]>(`/projects/${projectId}/roles`)).data
      : skipToken,
  });
}

function useRefresh(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.projectRoles.byProject(projectId) });
    // Đổi quyền của vai trò → danh sách thành viên (nhãn vai trò) và quyền hiệu lực trong dự án có thể đổi theo.
    void qc.invalidateQueries({ queryKey: keys.members.project(projectId) });
    void qc.invalidateQueries({ queryKey: keys.projects.permissions(projectId) });
  };
}

export function useCreateProjectRole(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (input: CreateProjectRoleInput) =>
      api.post<ProjectRoleDto>(`/projects/${projectId}/roles`, input).then((r) => r.data),
    onSuccess: (role) => {
      refresh();
      toast.success(`Đã tạo vai trò "${role.name}"`);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

export function useUpdateProjectRole(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateProjectRoleInput }) =>
      api.patch<ProjectRoleDto>(`/projects/${projectId}/roles/${id}`, patch).then((r) => r.data),
    onSuccess: (role) => {
      refresh();
      toast.success(`Đã lưu vai trò "${role.name}"`);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

/** Xoá vai trò đang có người giữ → 422 kèm số người (message từ máy chủ hiện qua toast). */
export function useDeleteProjectRole(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<Ack>(`/projects/${projectId}/roles/${id}`).then((r) => r.data),
    onSuccess: () => {
      refresh();
      toast.success('Đã xoá vai trò');
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

interface AssignableRoleOption {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Vai trò chọn được khi gán người vào MỘT dự án: vai trò của chính dự án đó; Quản trị (`organization:admin`) chọn được cả mẫu
 * dùng chung để không bị kẹt khi dự án chưa có vai trò nào. Gán sẵn bằng mẫu ở người khác vẫn hiển thị bình thường (không qua đây).
 */
export function useAssignableProjectRoles(projectId?: string) {
  const isAdmin = useAuth((s) => s.can('organization:admin'));
  const own = useProjectRoles(projectId);
  const templates = useRoles('PROJECT');
  const ownOptions: AssignableRoleOption[] = (own.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
  }));
  const options: AssignableRoleOption[] = isAdmin
    ? [
        ...ownOptions,
        ...(templates.data ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color ?? null })),
      ]
    : ownOptions;
  return {
    options,
    ownCount: ownOptions.length,
    loading: own.isLoading,
    /** Chưa có vai trò nào để chọn → giao diện gợi ý "Tạo vai trò từ mẫu". */
    needsRoles: !own.isLoading && options.length === 0,
  };
}
