import { useState } from 'react';

/**
 * Số lần `open` chuyển false → true (0 = chưa từng mở). Dùng làm `key` cho hộp thoại luôn mount:
 * mỗi lần mở là một lần mount mới nên form/mutation khởi tạo lại, không có khung hình nội dung cũ,
 * còn lúc đóng thì `key` giữ nguyên nên nội dung ở lại suốt hiệu ứng đóng.
 */
export function useOpenSession(open: boolean): number {
  const [prevOpen, setPrevOpen] = useState(open);
  const [session, setSession] = useState(open ? 1 : 0);
  if (open !== prevOpen) {
    // Điều chỉnh state ngay lúc render (mẫu React chính thống) → lần render này đã dùng key mới.
    setPrevOpen(open);
    if (open) setSession((n) => n + 1);
  }
  return session;
}
