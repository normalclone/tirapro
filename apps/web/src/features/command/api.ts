import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Số ký tự tối thiểu (sau trim) để gọi API tìm — gõ 1 ký tự sẽ ra cả kho issue, vô ích. */
export const QUICK_SEARCH_MIN_LENGTH = 2;

/**
 * Tìm nhanh issue bằng full-text (`mode=text`, xếp theo độ liên quan). Kết quả đã do server lọc, FE không lọc lại.
 * Chỉ chạy khi q (đã trim) đủ `QUICK_SEARCH_MIN_LENGTH` ký tự; request cũ bị huỷ khi người dùng gõ tiếp.
 */
export function useQuickSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: keys.search.quick(term),
    queryFn:
      term.length >= QUICK_SEARCH_MIN_LENGTH
        ? async ({ signal }) => {
            const url = `/search?q=${encodeURIComponent(term)}&mode=text&limit=8`;
            return (await api.get<ListResponse<IssueDto>>(url, { signal })).data.data;
          }
        : skipToken,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}
