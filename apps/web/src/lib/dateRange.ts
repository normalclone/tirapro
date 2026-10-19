import { fmtDate, fmtDayMonth } from './dateFormat';

/**
 * Logic thuần của khoảng ngày (`DateRangeInput`): đếm ngày, kiểm kết thúc ≥ bắt đầu, dòng tóm tắt.
 * Ngày vào là `yyyy-MM-dd` (hoặc ISO đầy đủ — chỉ lấy phần ngày); tính theo ngày UTC nên không lệch vì múi giờ/giờ mùa hè.
 */

export const DEFAULT_RANGE_ERROR = 'Ngày kết thúc không được trước ngày bắt đầu';

const DAY_MS = 86_400_000;

/** Số ngày UTC kể từ epoch của `yyyy-MM-dd`; null khi trống hoặc không có thật (vd 31/02). */
function dayNumber(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
    return null;
  return Math.round(t / DAY_MS);
}

/**
 * Số ngày lịch từ `start` tới `end`, TÍNH CẢ HAI ĐẦU (cùng ngày = 1). Cùng cách Gantt (`differenceInCalendarDays + 1`),
 * Kế hoạch (`durationDays`) và sprint ("hết hôm nay" khi hôm nay là ngày kết thúc: ngày kết thúc vẫn là ngày làm việc).
 * null khi thiếu/sai một đầu hoặc kết thúc trước bắt đầu.
 */
export function inclusiveDayCount(start: string, end: string): number | null {
  const a = dayNumber(start);
  const b = dayNumber(end);
  if (a === null || b === null || b < a) return null;
  return b - a + 1;
}

/** Lỗi khoảng ngày: kết thúc < bắt đầu (bằng nhau được). Thiếu một đầu = không lỗi — luật bắt buộc thuộc nơi dùng. */
export function dateRangeError(
  start: string,
  end: string,
  message: string = DEFAULT_RANGE_ERROR,
): string | null {
  const a = dayNumber(start);
  const b = dayNumber(end);
  return a !== null && b !== null && b < a ? message : null;
}

/**
 * "14 ngày · 20/10 – 02/11". Cả hai đầu cùng năm hiện tại thì bỏ năm; khác thì đủ năm cả hai (khỏi mơ hồ — như
 * `sprintTimeInfo`). Cùng một ngày: "1 ngày · 20/10". Thiếu đầu/sai thứ tự → '' (không có gì để tóm tắt).
 */
export function dateRangeSummary(start: string, end: string, now: Date = new Date()): string {
  const days = inclusiveDayCount(start, end);
  if (days === null) return '';
  const year = String(now.getFullYear());
  const fmt = start.slice(0, 4) === year && end.slice(0, 4) === year ? fmtDayMonth : fmtDate;
  const from = fmt(start.slice(0, 10));
  const to = fmt(end.slice(0, 10));
  return `${days} ngày · ${days === 1 ? from : `${from} – ${to}`}`;
}
