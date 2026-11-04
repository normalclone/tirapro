import { useQuery } from '@tanstack/react-query';
import type { MeOverviewDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Tổng quan cá nhân (`GET /me/overview`): việc của tôi, bug liên quan, điểm đã xong theo tuần — chỉ dự án tôi xem được. */
export function useMeOverview() {
  return useQuery({
    queryKey: keys.meOverview,
    queryFn: async () => (await api.get<MeOverviewDto>('/me/overview')).data,
    staleTime: 15_000,
  });
}
