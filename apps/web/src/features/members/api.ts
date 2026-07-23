import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberDto, UserDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { queryClient, qk } from '@/lib/queryClient';
import { useAuth } from '@/stores/auth';

/** Khoá cache cho danh sách thành viên của workspace hiện tại. */
export const workspaceUsersKey = ['workspace-users'] as const;
/** Khoá cache cho thành viên workspace kèm vai trò (GET /members). */
export const workspaceMembersKey = ['workspace-members'] as const;
/** Khoá cache cho thành viên của một dự án. */
export const projectMembersKey = (projectId: string) => ['project-members', projectId] as const;

/** Thân request cập nhật hồ sơ cá nhân (PATCH /users/me). */
export interface UpdateProfileInput {
  displayName?: string;
  timezone?: string;
  locale?: string;
  avatarUrl?: string | null;
}

/** Thân request đổi mật khẩu (POST /users/me/change-password). */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** Danh sách thành viên (user) trong workspace hiện tại. */
export function useWorkspaceUsers() {
  return useQuery({
    queryKey: workspaceUsersKey,
    queryFn: async () => (await api.get<UserDto[]>('/users')).data,
  });
}

/** Khoá cache cho toàn bộ user trong hệ thống (pool để chọn thêm vào workspace). */
export const allUsersKey = (search?: string) => ['all-users', search ?? ''] as const;

/**
 * Toàn bộ user trong hệ thống (pool do system admin quản lý ở nơi khác) — để chọn
 * thêm vào workspace hiện tại. Gated backend bằng `member:manage`.
 */
export function useAllUsers(search?: string) {
  const q = search?.trim() ?? '';
  return useQuery({
    queryKey: allUsersKey(q),
    queryFn: async () =>
      (await api.get<UserDto[]>('/users/all', { params: q ? { search: q } : undefined })).data,
  });
}

/**
 * Cập nhật hồ sơ của chính mình. Thành công thì làm mới cache `['me']` + danh sách
 * thành viên, và bootstrap lại auth store để header/avatar phản ánh thông tin mới.
 */
export function useUpdateProfile() {
  const bootstrap = useAuth((s) => s.bootstrap);
  return useMutation({
    mutationFn: async (input: UpdateProfileInput) =>
      (await api.patch<UserDto>('/users/me', input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.me });
      void queryClient.invalidateQueries({ queryKey: workspaceUsersKey });
      // Làm mới user/quyền trong auth store (cập nhật tên & avatar ở mọi nơi).
      void bootstrap();
    },
  });
}

/**
 * Đổi mật khẩu của chính mình. BE xác minh mật khẩu hiện tại; không cần đăng nhập
 * lại vì session (access + refresh) hiện tại vẫn giữ nguyên.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordInput) =>
      (await api.post('/users/me/change-password', input)).data,
  });
}

/** Refresh user ở mọi nơi (header, danh sách thành viên, avatar trên issue). */
function refreshUserEverywhere(bootstrap: () => Promise<void>) {
  void queryClient.invalidateQueries({ queryKey: qk.me });
  void queryClient.invalidateQueries({ queryKey: workspaceUsersKey });
  void bootstrap();
}

/** Tải ảnh đại diện của chính mình (multipart). */
export function useUploadUserAvatar() {
  const bootstrap = useAuth((s) => s.bootstrap);
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return (await api.post<UserDto>('/users/me/avatar', fd)).data;
    },
    onSuccess: () => refreshUserEverywhere(bootstrap),
  });
}

/** Gỡ ảnh đại diện của chính mình. */
export function useRemoveUserAvatar() {
  const bootstrap = useAuth((s) => s.bootstrap);
  return useMutation({
    mutationFn: async () => (await api.delete('/users/me/avatar')).data,
    onSuccess: () => refreshUserEverywhere(bootstrap),
  });
}

/* ------------------------------------------------------------------ */
/* Thành viên workspace (kèm vai trò)                                  */
/* ------------------------------------------------------------------ */

/** Danh sách thành viên workspace hiện tại kèm vai trò (GET /members). */
export function useWorkspaceMembers() {
  return useQuery({
    queryKey: workspaceMembersKey,
    queryFn: async () => (await api.get<MemberDto[]>('/members')).data,
  });
}

/**
 * Thêm một user CÓ SẴN (từ pool hệ thống) vào workspace hiện tại kèm vai trò.
 * Idempotent: nếu đã là thành viên thì cập nhật lại vai trò (POST /members).
 */
export function useAddMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleIds }: { userId: string; roleIds: string[] }) =>
      api.post<MemberDto>('/members', { userId, roleIds }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceMembersKey });
      void qc.invalidateQueries({ queryKey: workspaceUsersKey });
    },
  });
}

/** Đặt lại toàn bộ vai trò (≥1) cho một thành viên workspace. */
export function useSetMemberRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleIds }: { userId: string; roleIds: string[] }) =>
      api.put<MemberDto>(`/members/${userId}/roles`, { roleIds }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceMembersKey });
      void qc.invalidateQueries({ queryKey: workspaceUsersKey });
    },
  });
}

/** Gỡ một thành viên khỏi workspace (BE chặn gỡ owner/chính mình). */
export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/members/${userId}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceMembersKey });
      void qc.invalidateQueries({ queryKey: workspaceUsersKey });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Thành viên dự án (kèm vai trò scope PROJECT)                        */
/* ------------------------------------------------------------------ */

/** Danh sách thành viên của một dự án. */
export function useProjectMembers(projectId?: string) {
  return useQuery({
    queryKey: projectMembersKey(projectId ?? ''),
    queryFn: async () =>
      (await api.get<MemberDto[]>(`/projects/${projectId}/members`)).data,
    enabled: !!projectId,
  });
}

/** Thêm thành viên (user có sẵn trong workspace) vào dự án với ≥1 vai trò. */
export function useAddProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleIds }: { userId: string; roleIds: string[] }) =>
      api
        .post<MemberDto>(`/projects/${projectId}/members`, { userId, roleIds })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectMembersKey(projectId) });
    },
  });
}

/** Đặt lại vai trò (≥1) của một thành viên trong dự án. */
export function useSetProjectMemberRoles(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleIds }: { userId: string; roleIds: string[] }) =>
      api
        .put<MemberDto>(`/projects/${projectId}/members/${userId}/roles`, { roleIds })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectMembersKey(projectId) });
    },
  });
}

/** Gỡ một thành viên khỏi dự án. */
export function useRemoveProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/projects/${projectId}/members/${userId}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectMembersKey(projectId) });
    },
  });
}
