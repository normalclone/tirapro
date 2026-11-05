import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { MemberDto, PoolUserDto, UserDto } from '@tirapro/types';
import { api, type Ack } from '@/lib/api';
import { setAccessToken } from '@/lib/auth-token';
import { queryClient } from '@/lib/queryClient';
import { reconnectSocket } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { keys } from '@/lib/queryKeys';
import { userSearchQuery, USER_PICKER_LIMIT, type UserSearchOpts } from './userSearch';

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

/**
 * Tìm người PHÍA MÁY CHỦ (GET /users?projectId&search&limit): dự án riêng tư chỉ trả người xem được dự án, loại tài khoản
 * đã khoá (trừ khi `includeInactive`). Giữ kết quả cũ trong lúc gõ tiếp để danh sách không nháy trống.
 */
export function useSearchUsers(opts: UserSearchOpts & { enabled?: boolean } = {}) {
  const { enabled = true, ...q } = opts;
  const search = q.search?.trim() ?? '';
  const limit = q.limit ?? USER_PICKER_LIMIT;
  return useQuery({
    queryKey: keys.users.search(q.projectId ?? '', search, limit, q.includeInactive ?? false),
    queryFn: enabled
      ? async ({ signal }) =>
          (await api.get<UserDto[]>(`/users?${userSearchQuery({ ...q, search })}`, { signal })).data
      : skipToken,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Toàn bộ user trong hệ thống (pool do system admin quản lý ở nơi khác) — để chọn
 * thêm vào tổ chức hiện tại. Gated backend bằng `member:manage`.
 */
export function useAllUsers(search?: string, enabled = true) {
  const q = search?.trim() ?? '';
  return useQuery({
    queryKey: keys.users.all(q),
    queryFn: enabled
      ? async () =>
          (await api.get<PoolUserDto[]>('/users/all', { params: q ? { search: q } : undefined }))
            .data
      : skipToken,
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
      void queryClient.invalidateQueries({ queryKey: keys.me });
      void queryClient.invalidateQueries({ queryKey: keys.users.organization });
      // Làm mới user/quyền trong auth store (cập nhật tên & avatar ở mọi nơi).
      void bootstrap();
    },
  });
}

/**
 * Đổi mật khẩu của chính mình. BE xác minh mật khẩu hiện tại, thu hồi MỌI phiên (thiết bị khác phải đăng nhập lại)
 * và cấp phiên mới cho thiết bị này (access token trong body + cookie refresh) → không cần đăng nhập lại ở đây.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordInput) =>
      (
        await api.post<{ success: boolean; accessToken: string }>(
          '/users/me/change-password',
          input,
        )
      ).data,
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      reconnectSocket();
    },
  });
}

/** Đăng xuất mọi thiết bị của chính mình (kể cả thiết bị này). Gọi xong phải `useAuth.getState().logout()`. */
export function useLogoutAll() {
  return useMutation({
    mutationFn: async () => (await api.post<{ success: boolean }>('/auth/logout-all')).data,
  });
}

/** Refresh user ở mọi nơi (header, danh sách thành viên, avatar trên issue). */
function refreshUserEverywhere(bootstrap: () => Promise<void>) {
  void queryClient.invalidateQueries({ queryKey: keys.me });
  void queryClient.invalidateQueries({ queryKey: keys.users.organization });
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
    mutationFn: async () => (await api.delete<UserDto>('/users/me/avatar')).data,
    onSuccess: () => refreshUserEverywhere(bootstrap),
  });
}

/* ------------------------------------------------------------------ */
/* Thành viên của tổ chức (kèm vai trò)                    */
/* ------------------------------------------------------------------ */

/** Danh sách thành viên của tổ chức hiện tại kèm vai trò (GET /members). */
export function useOrganizationMembers(enabled = true) {
  return useQuery({
    queryKey: keys.members.organization,
    enabled,
    queryFn: async () => (await api.get<MemberDto[]>('/members')).data,
  });
}

/**
 * Thêm một user CÓ SẴN (từ pool hệ thống) vào tổ chức hiện tại kèm vai trò.
 * Idempotent: nếu đã là thành viên thì cập nhật lại vai trò (POST /members).
 */
export function useAddMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleIds }: { userId: string; roleIds: string[] }) =>
      api.post<MemberDto>('/members', { userId, roleIds }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.members.organization });
      void qc.invalidateQueries({ queryKey: keys.users.organization });
    },
  });
}

/** Kết quả tạo tài khoản: `tempPassword` chỉ có khi không nhập mật khẩu và chỉ trả MỘT lần. */
export interface CreateMemberAccountResult {
  member: MemberDto;
  tempPassword?: string;
}

/** Tạo tài khoản mới + thêm vào tổ chức hiện tại trong một lần (POST /members/accounts). */
export function useCreateMemberAccount() {
  const qc = useQueryClient();
  return useMutation({
    // Kết quả chứa mật khẩu tạm "chỉ hiện một lần" → không giữ trong MutationCache (gcTime 0 + reset() khi đóng khung).
    gcTime: 0,
    mutationFn: (input: {
      email: string;
      displayName: string;
      roleIds: string[];
      password?: string;
    }) => api.post<CreateMemberAccountResult>('/members/accounts', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.members.organization });
      void qc.invalidateQueries({ queryKey: keys.users.organization });
      void qc.invalidateQueries({ queryKey: keys.users.allRoot });
    },
  });
}

/** Thêm NHIỀU người vào tổ chức một lúc (cùng bộ vai trò). */
export function useAddMembersBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userIds, roleIds }: { userIds: string[]; roleIds: string[] }) =>
      api
        .post<{ added: number; skipped: number }>('/members/bulk', { userIds, roleIds })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.members.organization });
      void qc.invalidateQueries({ queryKey: keys.users.organization });
      void qc.invalidateQueries({ queryKey: keys.users.allRoot });
    },
  });
}

/** Gỡ một thành viên khỏi tổ chức (BE chặn gỡ owner/chính mình). */
export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete<Ack>(`/members/${userId}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.members.organization });
      void qc.invalidateQueries({ queryKey: keys.users.organization });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Thành viên dự án (kèm vai trò scope PROJECT)                        */
/* ------------------------------------------------------------------ */

/** Danh sách thành viên của một dự án. */
export function useProjectMembers(projectId?: string) {
  return useQuery({
    queryKey: keys.members.project(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<MemberDto[]>(`/projects/${projectId}/members`)).data
      : skipToken,
  });
}

/** Thêm NHIỀU người vào dự án một lúc (chỉ người đã thuộc tổ chức). */
export function useAddProjectMembersBulk(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userIds, roleIds }: { userIds: string[]; roleIds: string[] }) =>
      api
        .post<{
          added: number;
          skipped: number;
        }>(`/projects/${projectId}/members/bulk`, { userIds, roleIds })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.members.project(projectId) });
      void qc.invalidateQueries({ queryKey: keys.projects.permissions(projectId) });
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
      void qc.invalidateQueries({ queryKey: keys.members.project(projectId) });
      void qc.invalidateQueries({ queryKey: keys.projects.permissions(projectId) });
    },
  });
}

/** Gỡ một thành viên khỏi dự án. */
export function useRemoveProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.delete<Ack>(`/projects/${projectId}/members/${userId}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.members.project(projectId) });
      // Gỡ khỏi dự án riêng tư thì người đó cũng ra khỏi team riêng của dự án.
      void qc.invalidateQueries({ queryKey: keys.projectTeams.subTeams(projectId) });
      void qc.invalidateQueries({ queryKey: keys.projects.permissions(projectId) });
    },
  });
}
