import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditLogDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import type { AuditQuery } from './auditFilters';

const AUDIT_PAGE_SIZE = 30;

interface AuditPage {
  data: AuditLogDto[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null; limit: number };
}

/** Nhật ký quản trị của workspace (GET /audit) — phân trang theo con trỏ, "Tải thêm" nạp trang kế. */
export function useAuditLog(filters: AuditQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.audit.list(filters),
    enabled,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<AuditPage>('/audit', {
          params: { ...filters, limit: AUDIT_PAGE_SIZE, cursor: pageParam ?? undefined },
        })
      ).data,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : undefined),
  });
}
