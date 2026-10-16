/**
 * Trường chỉ-có-ngày (hạn, ngày bắt đầu…) được lưu dạng `YYYY-MM-DDT00:00:00.000Z` — là NGÀY LỊCH. Đọc phần
 * `YYYY-MM-DD` thay vì `new Date(iso)` để không lệch 1 ngày ở trình duyệt phía tây UTC.
 */
export function calendarDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y!, m! - 1, d);
}

export { formatCalendarDmy } from '@tirapro/shared';
