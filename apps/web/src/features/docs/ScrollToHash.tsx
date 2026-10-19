import { useEffect } from 'react';

/**
 * Cuộn tới mục `#<id>` của trang Hướng dẫn khi mở bằng liên kết sâu (`/documentation#vai-tro`, từ "Tìm hiểu thêm").
 * Nội dung trang dựng sau khi tải (lazy) nên trình duyệt không tự cuộn tới mục. Đặt cạnh trang trong cùng `Suspense`
 * để chạy sau khi trang đã có trong DOM.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);
  return null;
}
