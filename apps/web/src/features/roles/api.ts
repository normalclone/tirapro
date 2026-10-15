import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PermissionKey, RoleDto, RoleScope } from '@tirapro/types';
import { api, apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Thân request tạo vai trò tuỳ chỉnh. */
export interface CreateRoleInput {
  name: string;
  scope: RoleScope;
  description?: string | null;
  color?: string | null;
  permissionKeys: PermissionKey[];
}

/** Thân request cập nhật vai trò tuỳ chỉnh (role hệ thống → 403 từ BE). */
export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  permissionKeys?: PermissionKey[];
}

/** Danh sách vai trò. Bỏ `scope` để lấy tất cả (cấp chung + cấp dự án). */
export function useRoles(scope?: RoleScope) {
  return useQuery({
    queryKey: keys.roles.byScope(scope),
    queryFn: async () => {
      const qs = scope ? `?scope=${scope}` : '';
      return (await api.get<RoleDto[]>(`/roles${qs}`)).data;
    },
  });
}

/** Làm mới mọi biến thể cache vai trò (ALL/WORKSPACE/PROJECT). */
function invalidateAllRoles(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: keys.roles.all });
  // Đổi quyền của vai trò → quyền hiệu lực của mọi dự án có thể đổi theo.
  void qc.invalidateQueries({ queryKey: keys.projects.permissionsAll });
}

/** Tạo vai trò tuỳ chỉnh. */
export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoleInput) => api.post<RoleDto>('/roles', input).then((r) => r.data),
    onSuccess: (role) => {
      invalidateAllRoles(qc);
      toast.success(`Đã tạo vai trò "${role.name}"`);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

/** Cập nhật vai trò tuỳ chỉnh. */
export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateRoleInput }) =>
      api.patch<RoleDto>(`/roles/${id}`, patch).then((r) => r.data),
    onSuccess: (role) => {
      invalidateAllRoles(qc);
      toast.success(`Đã lưu vai trò "${role.name}"`);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

/** Xoá vai trò tuỳ chỉnh (hệ thống/đang dùng → 403, hiển thị message từ BE). */
export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/roles/${id}`).then((r) => r.data),
    onSuccess: () => {
      invalidateAllRoles(qc);
      toast.success('Đã xoá vai trò');
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}
