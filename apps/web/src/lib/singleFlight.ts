/**
 * Chạy `fn` tối đa MỘT lần tại một thời điểm: `ref.current` đặt ĐỒNG BỘ (khác `isPending` của react-query cập nhật sau
 * một lượt render) nên lần gọi thứ hai trong cùng tick — giữ phím Ctrl/⌘+Enter (key repeat), bấm đúp — bị bỏ qua
 * thay vì tạo bản ghi thứ hai. Tác vụ xong hoặc ném lỗi thì nhả khoá.
 */
export async function singleFlight(
  ref: { current: boolean },
  fn: () => Promise<void>,
): Promise<void> {
  if (ref.current) return;
  ref.current = true;
  try {
    await fn();
  } finally {
    ref.current = false;
  }
}
