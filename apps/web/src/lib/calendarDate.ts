/**
 * Trường chỉ-có-ngày (hạn, ngày bắt đầu…) được lưu dạng `YYYY-MM-DDT00:00:00.000Z` — là NGÀY LỊCH. Đọc phần
 * `YYYY-MM-DD` thay vì `new Date(iso)` để không lệch 1 ngày ở trình duyệt phía tây UTC.
 */
export function calendarDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y!, m! - 1, d);
}

export { formatCalendarDmy } from '@tirapro/shared';

/**
 * Ô ngày (`yyyy-MM-dd`) hoặc ngày+giờ giờ địa phương (`yyyy-MM-ddTHH:mm`) → ISO của NGÀY LỊCH (`…T00:00:00.000Z`).
 * KHÔNG dùng `new Date(local).toISOString()`: chọn giờ sớm (vd 00:30 giờ VN) sẽ lùi về ngày hôm trước ở UTC,
 * nên chú giải hạn hiện lệch 1 ngày so với ngày đã chọn (logbug #14).
 */
export function localToCalendarIso(local: string): string {
  return `${local.slice(0, 10)}T00:00:00.000Z`;
}
