import { useQuery } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';

export const quickSearchKey = (q: string) => ['quick-search', q] as const;

/**
 * Tìm nhanh issue bằng JQL `text ~ "..."`. Kết quả đã do server lọc, FE không lọc lại.
 * Chỉ chạy khi q (đã trim) >= 2 ký tự.
 */
export function useQuickSearch(q: string) {
  return useQuery({
    queryKey: quickSearchKey(q),
    queryFn: async () => {
      const sanitized = q.replace(/"/g, '');
      const jql = `text ~ "${sanitized}"`;
      const url = `/search?jql=${encodeURIComponent(jql)}&limit=8`;
      return (await api.get<ListResponse<IssueDto>>(url)).data.data;
    },
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });
}
