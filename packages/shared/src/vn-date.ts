/**
 * Ngày giờ theo giờ Việt Nam cho phía máy chủ (múi giờ máy chủ có thể khác) và CSV. MỘT nơi định nghĩa —
 * các CSV/ghi chú không tự dựng lại `Intl.DateTimeFormat`.
 */
const VN_ZONE = 'Asia/Ho_Chi_Minh';
const VN_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: VN_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function vnParts(d: Date): Record<string, string> {
  return Object.fromEntries(VN_PARTS.formatToParts(d).map((p) => [p.type, p.value]));
}

/** `dd/MM/yyyy HH:mm` giờ Việt Nam; rỗng/không hợp lệ → ''. */
export function formatVnDateTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = vnParts(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** Ngày lịch (hạn, ngày bắt đầu… lưu `YYYY-MM-DDT00:00:00Z`) → `dd/MM/yyyy`, không lệch múi giờ; rỗng → ''. */
export function formatCalendarDmy(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** `yyyyMMdd` của ngày hiện tại theo giờ Việt Nam (cho tên file). */
export function vnDayStamp(now: Date = new Date()): string {
  const p = vnParts(now);
  return `${p.year}${p.month}${p.day}`;
}

/** Nửa đêm UTC của NGÀY LỊCH Việt Nam đang diễn ra (định dạng ngày dùng chung của nhân lực/tuần). */
export function vnTodayUtc(now: Date = new Date()): Date {
  const p = vnParts(now);
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
}

/**
 * Ranh giới "quá hạn" theo NGÀY LỊCH Việt Nam: việc quá hạn khi `dueDate < overdueCutoff()`; việc có hạn HÔM NAY (giờ VN)
 * CHƯA quá hạn. `dueDate` lưu `YYYY-MM-DDT00:00:00Z` (ngày lịch) nên so với "bây giờ" (`lt: now`) sẽ tính quá hạn từ 07:00 VN
 * của chính ngày hạn — MỘT định nghĩa này dùng cho Tổng quan, Sức khoẻ dự án, Danh mục, digest và thẻ OKR để các màn khớp nhau.
 * Cùng giá trị với `vnTodayUtc` (đầu ngày VN dưới dạng nửa đêm UTC).
 */
export function overdueCutoff(now: Date = new Date()): Date {
  return vnTodayUtc(now);
}
