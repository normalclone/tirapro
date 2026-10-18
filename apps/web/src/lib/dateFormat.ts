// eslint-disable-next-line no-restricted-imports -- đây chính là chỗ bọc `formatDistance` với locale vi
import { format, formatDistance, isValid } from 'date-fns';
import { vi } from 'date-fns/locale';

/**
 * Định dạng ngày giờ tiếng Việt — MỘT nguồn duy nhất (docs/UX_CONVENTIONS.md §19).
 * Ngày `dd/MM/yyyy`, giờ `HH:mm` (24h), thời gian tương đối bằng tiếng Việt.
 * ESLint chặn `formatDistanceToNow`/`toLocaleDateString` để không tái phạm.
 */

type DateLike = string | number | Date | null | undefined;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Chuỗi `yyyy-MM-dd` thuần parse theo giờ địa phương (tránh lệch ngày do UTC); còn lại `new Date(v)`. */
function toDate(v: DateLike): Date | null {
  if (v === null || v === undefined || v === '') return null;
  let d: Date;
  if (v instanceof Date) d = v;
  else if (typeof v === 'string' && DATE_ONLY.test(v)) {
    const [y, m, day] = v.split('-').map(Number) as [number, number, number];
    d = new Date(y, m - 1, day);
  } else d = new Date(v);
  return isValid(d) ? d : null;
}

/** `05/08/2026`; rỗng/không hợp lệ → `—`. */
export function fmtDate(v: DateLike): string {
  const d = toDate(v);
  return d ? format(d, 'dd/MM/yyyy') : '—';
}

/** `05/08` — nhãn trục biểu đồ / chỗ hẹp (đầy đủ ngày-tháng-năm nằm ở tooltip); rỗng/không hợp lệ → `—`. */
export function fmtDayMonth(v: DateLike): string {
  const d = toDate(v);
  return d ? format(d, 'dd/MM') : '—';
}

/** `T10/2026` — nhãn tháng (lộ trình, Gantt); rỗng/không hợp lệ → `—`. */
export function fmtMonthYear(v: DateLike): string {
  const d = toDate(v);
  return d ? `T${d.getMonth() + 1}/${d.getFullYear()}` : '—';
}

const WEEKDAYS_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** `Thứ Bảy, 17/10/2026` — dòng ngày hôm nay ở Tổng quan; rỗng/không hợp lệ → `—`. */
export function fmtLongDate(v: DateLike): string {
  const d = toDate(v);
  return d ? `${WEEKDAYS_VI[d.getDay()]}, ${format(d, 'dd/MM/yyyy')}` : '—';
}

/** `05/08/2026 14:30`; rỗng/không hợp lệ → `—`. */
export function fmtDateTime(v: DateLike): string {
  const d = toDate(v);
  return d ? format(d, 'dd/MM/yyyy HH:mm') : '—';
}

/** `05/08/2026 14:30:09` — cho nhật ký chạy cần tới giây. */
export function fmtDateTimeSec(v: DateLike): string {
  const d = toDate(v);
  return d ? format(d, 'dd/MM/yyyy HH:mm:ss') : '—';
}

/** `khoảng 5 giờ trước`; không hợp lệ → chuỗi rỗng. `now` để test được. */
export function fmtRelative(v: DateLike, now: Date = new Date()): string {
  const d = toDate(v);
  if (!d) return '';
  // date-fns ra "dưới 1 phút trước" — gượng; dưới một phút đọc là "vừa xong".
  if (Math.abs(now.getTime() - d.getTime()) < 60_000) return 'vừa xong';
  return formatDistance(d, now, { addSuffix: true, locale: vi });
}

/** Giá trị cho `<input type="date">`: `yyyy-MM-dd` theo giờ địa phương ('' nếu không hợp lệ). */
export function toDateInput(v: DateLike): string {
  const d = toDate(v);
  return d ? format(d, 'yyyy-MM-dd') : '';
}

/** Giá trị cho `<input type="datetime-local">`: `yyyy-MM-ddTHH:mm` giờ địa phương ('' nếu không hợp lệ). */
export function toDateTimeInput(v: DateLike): string {
  const d = toDate(v);
  return d ? format(d, "yyyy-MM-dd'T'HH:mm") : '';
}
