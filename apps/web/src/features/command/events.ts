/** Sự kiện cửa sổ: nút Bình luận / phím m / Cmd+K → trang chi tiết công việc đưa con trỏ vào ô viết bình luận. */
export const FOCUS_COMMENT_EVENT = 'tirapro:focus-comment';

/** Id của ô viết bình luận (CommentsSection) — listener tìm theo id này, không phụ thuộc placeholder. */
export const COMMENT_INPUT_ID = 'issue-comment-input';

/**
 * Nhờ trang chi tiết công việc mở tab Bình luận, cuộn tới và đưa con trỏ vào ô viết.
 * MỘT đường chung cho nút "Bình luận", phím `m` và lệnh Cmd+K "Thêm bình luận".
 */
export const requestFocusComment = () => window.dispatchEvent(new Event(FOCUS_COMMENT_EVENT));
