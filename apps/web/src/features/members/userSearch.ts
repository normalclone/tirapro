/** Tìm người phía máy chủ cho bộ chọn người được giao / @mention (GET /users?projectId&search&limit). */

/** Số người hiện khi chưa gõ — cũng là mặc định của API. */
export const USER_PICKER_LIMIT = 50;
/** Giới hạn tối đa API cho phép. */
export const USER_PICKER_MAX = 200;

export interface UserSearchOpts {
  projectId?: string;
  search?: string;
  limit?: number;
  /** Gồm cả tài khoản đã khoá (bộ lọc theo người cần lọc được việc của họ). */
  includeInactive?: boolean;
}

/** Chuỗi query của GET /users (bỏ tham số trống; `limit` kẹp trong 1..200). */
export function userSearchQuery(o: UserSearchOpts): string {
  const p = new URLSearchParams();
  if (o.projectId) p.set('projectId', o.projectId);
  const s = o.search?.trim();
  if (s) p.set('search', s);
  const limit = Math.min(Math.max(Math.floor(o.limit ?? USER_PICKER_LIMIT), 1), USER_PICKER_MAX);
  p.set('limit', String(limit));
  if (o.includeInactive) p.set('includeInactive', 'true');
  return p.toString();
}

/** Hiện dòng "Gõ để tìm thêm": chưa gõ gì mà danh sách đã đầy `limit` (có thể còn người chưa hiện). */
export function showTypeToSearchHint(count: number, search: string, limit = USER_PICKER_LIMIT) {
  return search.trim() === '' && count >= limit;
}
