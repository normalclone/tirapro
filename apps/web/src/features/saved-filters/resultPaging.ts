import type { CursorPageInfo, IssueDto, ListResponse } from '@tirapro/types';

/** Một lượt kết quả của bộ lọc/JQL: các việc đã nạp + còn trang kế (theo cursor API trả) hay không. */
export interface ResultSet {
  items: IssueDto[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** `limit` mỗi lượt nạp (API cho tối đa 200; giữ 100 như trước). */
export const RESULT_FETCH_LIMIT = 100;

/** Envelope danh sách → ResultSet; `pageInfo` kiểu offset/thiếu → coi là hết. */
export function toResultSet(res: Pick<ListResponse<IssueDto>, 'data' | 'pageInfo'>): ResultSet {
  const pi = res.pageInfo as Partial<CursorPageInfo> | undefined;
  const hasMore = pi?.hasNextPage === true && typeof pi.endCursor === 'string';
  return { items: res.data, hasMore, nextCursor: hasMore ? (pi.endCursor ?? null) : null };
}

/** Nối trang kế vào kết quả đang có (bỏ trùng theo id phòng cursor chồng). */
export function appendResults(base: ResultSet, next: ResultSet): ResultSet {
  const seen = new Set(base.items.map((i) => i.id));
  return {
    items: [...base.items, ...next.items.filter((i) => !seen.has(i.id))],
    hasMore: next.hasMore,
    nextCursor: next.nextCursor,
  };
}

/** "N công việc" khi đã đủ; "N công việc đầu tiên" khi còn nữa (không ghi con số cắt như tổng). */
export function resultCountLabel(count: number, hasMore: boolean): string {
  return hasMore ? `${count} công việc đầu tiên` : `${count} công việc`;
}

/** Số dòng mỗi trang của bảng kết quả. */
export const RESULTS_PAGE_SIZE = 25;

/** Trang (1-based) chứa dòng thứ `index` (0-based) của kết quả đã nạp — để `reveal` mở đúng trang. */
export function pageOfIndex(index: number, pageSize = RESULTS_PAGE_SIZE): number {
  return index < 0 ? 1 : Math.floor(index / pageSize) + 1;
}

/** Trạng thái trang của bảng kết quả + nguồn/kết quả gốc mà trang đó thuộc về (so theo tham chiếu). */
export interface PagingState {
  page: number;
  active: unknown;
  base: unknown;
}

export type PagingAction =
  | { type: 'go'; page: number }
  /** Nguồn hoặc kết quả GỐC có thể đã đổi (so tham chiếu). "Tải thêm" chỉ nối thêm vào `more`, không đổi gốc → giữ trang. */
  | { type: 'sync'; active: unknown; base: unknown };

export const initialPaging = (active: unknown, base: unknown): PagingState => ({
  page: 1,
  active,
  base,
});

/**
 * Trang hiện tại: chuyển trang = đặt trang; đổi bộ lọc/nguồn hoặc chạy lại (kết quả gốc mới) → về trang 1; nối thêm kết quả
 * ("Tải thêm") thì GIỮ trang — nếu không dòng đang xem nhanh sẽ biến mất khỏi khung và "Việc sau" ở cuối nhảy về trang 1 giữa chừng.
 */
export function pagingReducer(s: PagingState, a: PagingAction): PagingState {
  if (a.type === 'go') return { ...s, page: Math.max(1, a.page) };
  if (a.active === s.active && a.base === s.base) return s;
  return { page: 1, active: a.active, base: a.base };
}
