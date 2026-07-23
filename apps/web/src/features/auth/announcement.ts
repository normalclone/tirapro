import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Announcement {
  maintenanceBanner: string;
  signupEnabled: boolean;
}

/**
 * Thông báo hệ thống công khai (`GET /health/announcement`) — dùng chung với
 * MaintenanceBanner (cùng query key nên chia sẻ cache). `signupEnabled` điều khiển
 * việc mở đăng ký công khai; mặc định coi như bật cho tới khi có dữ liệu.
 */
export function useAnnouncement() {
  return useQuery({
    queryKey: ['system-announcement'],
    queryFn: async () => (await api.get<Announcement>('/health/announcement')).data,
    staleTime: 30_000,
  });
}

/** Đăng ký công khai có đang bật không (mặc định `true` khi chưa có dữ liệu/lỗi). */
export function useSignupEnabled(): { enabled: boolean; loading: boolean } {
  const { data, isLoading } = useAnnouncement();
  return { enabled: data?.signupEnabled ?? true, loading: isLoading };
}
