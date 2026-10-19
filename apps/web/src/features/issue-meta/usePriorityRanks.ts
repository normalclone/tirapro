import { useMemo } from 'react';
import { usePriorities } from '@/features/settings-admin/api';

/** Dự phòng khi danh sách ưu tiên chưa tải xong: 5 mức mặc định của hệ thống (rank 1–5). */
const DEFAULT_PRIORITY_RANKS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Mọi hạng ưu tiên của workspace — để `PriorityIcon` suy mũi tên. Dùng chung query `priorities`
 * (mọi thành viên đọc được); chưa tải xong thì rơi về 5 mức mặc định để không nháy.
 */
export function usePriorityRanks(): readonly number[] {
  const { data } = usePriorities();
  return useMemo(
    () => (data && data.length > 0 ? data.map((p) => p.rank) : DEFAULT_PRIORITY_RANKS),
    [data],
  );
}
