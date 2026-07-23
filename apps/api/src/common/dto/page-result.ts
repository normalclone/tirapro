import type { CursorPageInfo, OffsetPageInfo } from '@tirapro/types';

/** Marker để ResponseInterceptor bọc thành list envelope. */
export class PageResult<T> {
  constructor(
    public readonly data: T[],
    public readonly pageInfo: CursorPageInfo | OffsetPageInfo,
  ) {}
}

export function cursorPage<T>(
  data: T[],
  limit: number,
  getCursor: (item: T) => string,
): PageResult<T> {
  const hasNextPage = data.length > limit;
  const items = hasNextPage ? data.slice(0, limit) : data;
  const endCursor = items.length ? getCursor(items[items.length - 1]!) : null;
  return new PageResult(items, { hasNextPage, endCursor, limit });
}

export function offsetPage<T>(
  data: T[],
  page: number,
  pageSize: number,
  totalItems: number,
): PageResult<T> {
  return new PageResult(data, {
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  });
}
