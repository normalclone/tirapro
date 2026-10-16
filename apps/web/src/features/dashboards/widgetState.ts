import axios from 'axios';

/** Trạng thái hiển thị của MỘT ô — mỗi ô tự quyết, lỗi của ô này không lan sang ô khác. */
export type WidgetState = 'loading' | 'error' | 'empty' | 'ready' | 'forbidden';

export function httpStatusOf(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

/** 403 (thiếu quyền) và 404 (dự án riêng tư/đã xoá — máy chủ che sự tồn tại) đều là "không xem được". */
export function isForbiddenError(err: unknown): boolean {
  const s = httpStatusOf(err);
  return s === 403 || s === 404;
}

/** Phần tối thiểu của kết quả `useQuery` mà ô cần. */
export interface WidgetQuery<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
}

/**
 * Suy ra trạng thái ô từ một truy vấn. Chỉ coi là lỗi khi CHƯA có dữ liệu (làm mới nền lỗi vẫn giữ số cũ).
 * `isEmpty` quyết định "có dữ liệu nhưng không có gì để vẽ".
 */
export function queryWidgetState<T>(
  q: WidgetQuery<T>,
  isEmpty: (data: T) => boolean = () => false,
): WidgetState {
  if (q.data === undefined) {
    if (!q.isError) return 'loading';
    return isForbiddenError(q.error) ? 'forbidden' : 'error';
  }
  return isEmpty(q.data) ? 'empty' : 'ready';
}
