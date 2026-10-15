/**
 * Trường chỉ-có-ngày (hạn, ngày bắt đầu…) được lưu dạng `YYYY-MM-DDT00:00:00.000Z` — là NGÀY LỊCH. Đọc phần
 * `YYYY-MM-DD` thay vì `new Date(iso)` để không lệch 1 ngày ở trình duyệt phía tây UTC.
 */
export function calendarDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y!, m! - 1, d);
}

/** `dd/MM/yyyy` của ngày lịch; rỗng khi không có ngày. */
export function formatCalendarDmy(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
