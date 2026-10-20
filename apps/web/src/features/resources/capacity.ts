/**
 * Tuần & "còn trống" của nhân lực — thuần, KHÔNG phụ thuộc múi giờ.
 *
 * Máy chủ (`resources/date.util.ts`) tính tuần trên NGÀY UTC, tuần bắt đầu THỨ HAI (`startOfWeek`). Ngày ở đây là chuỗi
 * `YYYY-MM-DD`; mọi phép tính ngày dùng số học UTC trên chuỗi đó, nên kết quả không đổi theo múi giờ trình duyệt và khớp tuần
 * mà `GET /resources/workload` trả về.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` (ngày UTC) của một giá trị ngày: chuỗi ngày thuần / ISO có `Z` lấy 10 ký tự đầu; dạng khác đổi qua Date → UTC. */
function utcDayOf(v: string | null | undefined): string | null {
  if (!v) return null;
  if (DATE_PREFIX.test(v) && (v.length === 10 || v.endsWith('Z'))) {
    const iso = v.slice(0, 10);
    return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

function toMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Thứ Hai (YYYY-MM-DD) của tuần chứa `day`; đầu vào hỏng → null. Chủ nhật thuộc tuần TRƯỚC (như máy chủ). */
export function weekStartOf(day: string): string | null {
  const iso = utcDayOf(day);
  if (!iso) return null;
  const ms = toMs(iso);
  const dow = new Date(ms).getUTCDay(); // 0 = CN … 6 = T7
  return fromMs(ms + (dow === 0 ? -6 : 1 - dow) * DAY_MS);
}

/** Chủ nhật (YYYY-MM-DD) của tuần bắt đầu `monday`. */
export function weekEndOf(monday: string): string {
  return fromMs(toMs(monday) + 6 * DAY_MS);
}

/** Tuần (thứ Hai) để xem "còn trống" cho một việc: tuần của HẠN, nếu không có thì của NGÀY BẮT ĐẦU, nếu không thì tuần hiện tại. */
export function issueWeekStart(
  issue: { dueDate?: string | null; startDate?: string | null },
  today: string,
): string {
  return (
    (issue.dueDate ? weekStartOf(issue.dueDate) : null) ??
    (issue.startDate ? weekStartOf(issue.startDate) : null) ??
    weekStartOf(today) ??
    today
  );
}

/** Phần ô tuần của `/resources/workload` mà gợi ý cần. */
export interface CapacityCell {
  weekStart: string;
  capacityHours: number;
  assignedHours: number;
  workingDays: number;
  offDays: number;
}

export interface AvailabilityHint {
  kind: 'free' | 'full' | 'over' | 'off';
  /** Giờ còn trống (kind free) hoặc giờ quá tải (kind over); 0 với full/off. */
  hours: number;
  text: string;
}

/** |dư| dưới ngưỡng này coi như vừa kín lịch (tránh "còn trống ~0 giờ"). */
const FULL_EPSILON_HOURS = 0.5;

/**
 * Câu "còn trống ~N giờ/tuần" / "quá tải ~N giờ" cho một ô tuần. Thiếu số liệu → null (không hiện gì).
 * `capacity − assigned` là số ƯỚC LƯỢNG theo ước lượng giờ của việc (không phải chấm công).
 */
export function availabilityHint(cell: CapacityCell | undefined): AvailabilityHint | null {
  if (!cell) return null;
  const { capacityHours: cap, assignedHours: used } = cell;
  if (!Number.isFinite(cap) || !Number.isFinite(used)) return null;
  const free = cap - used;
  if (cell.workingDays === 0 && cell.offDays > 0 && used < FULL_EPSILON_HOURS)
    return { kind: 'off', hours: 0, text: 'nghỉ cả tuần' };
  if (Math.abs(free) < FULL_EPSILON_HOURS) return { kind: 'full', hours: 0, text: 'kín lịch' };
  const hours = Math.round(Math.abs(free));
  return free > 0
    ? { kind: 'free', hours, text: `còn trống ~${hours} giờ/tuần` }
    : { kind: 'over', hours, text: `quá tải ~${hours} giờ` };
}
