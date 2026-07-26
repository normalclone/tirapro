import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { setAccessToken } from '@/lib/auth-token';
import { queryClient } from '@/lib/queryClient';

/** Không gian làm việc mà người dùng hiện tại là thành viên (kèm vai trò). */
export interface MyWorkspace {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  roleName: string;
}

interface SwitchWorkspaceResponse {
  accessToken: string;
  expiresIn?: number;
  user: unknown;
}

interface InviteInput {
  email: string;
  displayName: string;
  /** Vai trò chung gán cho người được mời (tuỳ chọn; BE mặc định nếu trống). */
  roleIds?: string[];
}

interface InviteResponse {
  userId: string;
  email: string;
  invited: boolean;
  tempPassword?: string;
}

export const myWorkspacesKey = ['my-workspaces'] as const;

/** Danh sách không gian làm việc của người dùng hiện tại. */
export function useMyWorkspaces() {
  return useQuery({
    queryKey: myWorkspacesKey,
    queryFn: async () => (await api.get<MyWorkspace[]>('/auth/workspaces')).data,
  });
}

/**
 * Đổi không gian làm việc đang hoạt động. Server cấp access token mới + xoay refresh cookie.
 * onSuccess: nạp token mới, xoá toàn bộ cache (để mọi dữ liệu refetch theo nơi mới),
 * rồi reload về trang chủ — bootstrap() sẽ nạp lại user/quyền theo nơi mới.
 */
export function useSwitchWorkspace() {
  return useMutation({
    mutationFn: (workspaceId: string) =>
      api
        .post<SwitchWorkspaceResponse>('/auth/switch-workspace', { workspaceId })
        .then((r) => r.data),
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      queryClient.clear();
      window.location.assign('/');
    },
  });
}

/** Mời thành viên vào không gian làm việc hiện tại. */
export function useInvite() {
  return useMutation({
    mutationFn: (v: InviteInput) =>
      api.post<InviteResponse>('/auth/invite', v).then((r) => r.data),
  });
}

/** Tải logo/ảnh của không gian làm việc (chỉ quản trị chung). */
export function useUploadWorkspaceAvatar(workspaceId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return (await api.post(`/workspaces/${workspaceId}/avatar`, fd)).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myWorkspacesKey });
    },
  });
}

/** Gỡ logo/ảnh của không gian làm việc. */
export function useRemoveWorkspaceAvatar(workspaceId: string) {
  return useMutation({
    mutationFn: async () => (await api.delete(`/workspaces/${workspaceId}/avatar`)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myWorkspacesKey });
    },
  });
}
