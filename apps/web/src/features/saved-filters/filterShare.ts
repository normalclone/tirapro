import type { SavedFilter } from './api';

/** Chỉ CHỦ bộ lọc (có `filter:manage`) đổi được phạm vi chia sẻ — khớp `requireOwned` + `@Permissions(FILTER_MANAGE)` ở máy chủ. */
export const canChangeFilterShare = (
  f: Pick<SavedFilter, 'isOwner'>,
  canManage: boolean,
): boolean => f.isOwner && canManage;

export type RouteFilterState =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'missing' }
  | { state: 'found'; filter: SavedFilter };

/**
 * `/filters/:id` → bộ lọc cần nạp. Danh sách `GET /filters` CHỈ chứa bộ lọc người xem thấy (của mình, hoặc chia sẻ cho
 * họ — máy chủ đã lọc theo quyền xem dự án), nên không có trong đó = "không thấy", KHÔNG phân biệt không tồn tại / đã xoá /
 * không có quyền (không lộ sự tồn tại của bộ lọc riêng tư).
 */
export function resolveRouteFilter(
  q: { data: readonly SavedFilter[] | undefined; isError: boolean },
  id: string | undefined,
): RouteFilterState {
  if (!id) return { state: 'none' };
  if (!q.data) return { state: q.isError ? 'error' : 'loading' };
  const filter = q.data.find((f) => f.id === id);
  return filter ? { state: 'found', filter } : { state: 'missing' };
}
