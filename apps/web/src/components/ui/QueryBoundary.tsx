import type { ReactNode } from 'react';
import { QueryError } from '@/components/ui/QueryError';
import { DelayedSpinner } from '@/components/ui/primitives';

/** Phần tối thiểu của kết quả `useQuery`/`useInfiniteQuery` mà QueryBoundary cần. */
interface BoundaryQuery<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * QueryBoundary — một chỗ duy nhất quyết định 4 trạng thái của một truy vấn:
 * đang tải (skeleton) · lỗi (QueryError có "Thử lại") · rỗng (emptyState) · có dữ liệu.
 *
 * Chỉ coi là lỗi khi CHƯA có dữ liệu: nếu làm mới nền thất bại mà vẫn còn dữ liệu cũ thì
 * giữ nguyên danh sách thay vì thay bằng màn lỗi.
 */
export function QueryBoundary<T>({
  query,
  skeleton,
  empty,
  emptyState,
  children,
}: {
  query: BoundaryQuery<T>;
  /** Mặc định: DelayedSpinner (không nháy nếu tải nhanh). */
  skeleton?: ReactNode;
  /** Trả true nếu dữ liệu coi như rỗng. */
  empty?: (data: T) => boolean;
  emptyState?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { data, isError, error, refetch } = query;
  if (data === undefined) {
    if (isError) return <QueryError error={error} onRetry={() => void refetch()} />;
    return <>{skeleton ?? <DelayedSpinner />}</>;
  }
  if (empty?.(data)) return <>{emptyState ?? null}</>;
  return <>{children(data)}</>;
}
