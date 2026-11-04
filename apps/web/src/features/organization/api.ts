import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { setAccessToken } from '@/lib/auth-token';
import { queryClient } from '@/lib/queryClient';
import { clearSessionCaches } from '@/lib/sessionCache';
import { keys } from '@/lib/queryKeys';
import { commitLeaveApp } from '@/stores/leaveGuard';

/** Tổ chức mà người dùng hiện tại là thành viên (kèm vai trò). */
export interface MyOrganization {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  roleName: string;
  /** Số thành viên đang hoạt động. Tuỳ chọn: API cũ (chưa triển khai) không trả trường này. */
  memberCount?: number;
}

/** Phản hồi sau khi đổi/gỡ logo: thông tin rút gọn của tổ chức. */
interface OrganizationAvatarResult {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
}

interface SwitchOrganizationResponse {
  accessToken: string;
  expiresIn?: number;
  user: unknown;
}

/** Danh sách tổ chức của người dùng hiện tại. */
export function useMyOrganizations() {
  return useQuery({
    queryKey: keys.organizations.mine,
    queryFn: async () => (await api.get<MyOrganization[]>('/auth/organizations')).data,
  });
}

/**
 * Đổi tổ chức đang hoạt động. Server cấp access token mới + xoay refresh cookie.
 * onSuccess: bỏ nháp chưa lưu (`commitLeaveApp`, người gọi đã hỏi trước bằng `useConfirmLeaveApp`), nạp token mới, xoá toàn bộ cache (để mọi dữ liệu refetch theo nơi mới),
 * rồi reload về trang chủ — bootstrap() sẽ nạp lại user/quyền theo nơi mới.
 */
export function useSwitchOrganization() {
  return useMutation({
    mutationFn: (organizationId: string) =>
      api
        .post<SwitchOrganizationResponse>('/auth/switch-organization', { organizationId })
        .then((r) => r.data),
    onSuccess: (data) => {
      // Đổi thành công mới bỏ nháp chưa lưu (người dùng đã đồng ý ở bước hỏi); lỗi thì không tới đây → nháp còn.
      // `try/finally`: một `onDiscard` ném lỗi không được chặn việc nạp token mới + tải lại (đã đổi xong ở máy chủ).
      try {
        commitLeaveApp();
      } finally {
        setAccessToken(data.accessToken);
        clearSessionCaches();
        window.location.assign('/');
      }
    },
  });
}

/** Tải logo/ảnh của tổ chức (chỉ quản trị chung). */
export function useUploadOrganizationAvatar(organizationId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return (
        await api.post<OrganizationAvatarResult>(`/organizations/${organizationId}/avatar`, fd)
      ).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.organizations.mine });
    },
  });
}

/** Gỡ logo/ảnh của tổ chức. */
export function useRemoveOrganizationAvatar(organizationId: string) {
  return useMutation({
    mutationFn: async () =>
      (await api.delete<OrganizationAvatarResult>(`/organizations/${organizationId}/avatar`)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.organizations.mine });
    },
  });
}
