import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { setAccessToken } from '@/lib/auth-token';
import { queryClient } from '@/lib/queryClient';
import { clearSessionCaches } from '@/lib/sessionCache';
import { keys } from '@/lib/queryKeys';

/** Không gian làm việc mà người dùng hiện tại là thành viên (kèm vai trò). */
export interface MyWorkspace {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  roleName: string;
}

/** Phản hồi sau khi đổi/gỡ logo: thông tin rút gọn của không gian làm việc. */
interface WorkspaceAvatarResult {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
}

interface SwitchWorkspaceResponse {
  accessToken: string;
  expiresIn?: number;
  user: unknown;
}

/** Danh sách không gian làm việc của người dùng hiện tại. */
export function useMyWorkspaces() {
  return useQuery({
    queryKey: keys.workspaces.mine,
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
      clearSessionCaches();
      window.location.assign('/');
    },
  });
}

/** Tải logo/ảnh của không gian làm việc (chỉ quản trị chung). */
export function useUploadWorkspaceAvatar(workspaceId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return (await api.post<WorkspaceAvatarResult>(`/workspaces/${workspaceId}/avatar`, fd)).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspaces.mine });
    },
  });
}

/** Gỡ logo/ảnh của không gian làm việc. */
export function useRemoveWorkspaceAvatar(workspaceId: string) {
  return useMutation({
    mutationFn: async () =>
      (await api.delete<WorkspaceAvatarResult>(`/workspaces/${workspaceId}/avatar`)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspaces.mine });
    },
  });
}
