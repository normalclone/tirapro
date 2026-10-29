/**
 * Thanh tab đáy (dưới `lg` = 1024px): cao 56px, cộng vùng an toàn iOS ở đáy. Là con flex của khung (không `fixed`)
 * nên không che nội dung; hằng này chỉ dùng cho thứ nằm NGOÀI luồng khung (toast).
 */
export const BOTTOM_BAR_PX = 56;
/** Ngưỡng hiện thanh đáy / ẩn sidebar + FAB (= `lg` của Tailwind). */
export const DESKTOP_MIN_QUERY = '(min-width: 1024px)';

/** Số chưa đọc hiển thị trên ô Thông báo: tối đa "99+" (ô hẹp, không để số dài tràn). */
export function unreadBadgeText(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** Tên truy cập của ô Thông báo: kèm số chưa đọc (đọc đủ số thật, không cắt "99+"). */
export function notificationsTabLabel(unread: number): string {
  return unread > 0 ? `Thông báo, ${unread} chưa đọc` : 'Thông báo';
}
