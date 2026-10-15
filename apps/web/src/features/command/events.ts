/** Sự kiện cửa sổ: Cmd+K → trang chi tiết công việc đưa con trỏ vào ô viết bình luận. */
export const FOCUS_COMMENT_EVENT = 'tirapro:focus-comment';

/** Sự kiện cửa sổ: Cmd+K → trang chi tiết công việc xử lý đổi trạng thái (hiện hộp Cách giải quyết/Lý do khi cần). */
export const REQUEST_TRANSITION_EVENT = 'tirapro:request-transition';
export interface RequestTransitionDetail {
  toStatusId: string;
}
