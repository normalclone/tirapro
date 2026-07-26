/**
 * Tiện ích ngày cho Năng lực/Tải nguồn lực.
 *
 * Quy ước: MỌI mốc ngày được chuẩn hoá về nửa đêm UTC. Allocation/TimeOff/WorkLog là
 * dữ liệu "theo ngày" (không theo giờ địa phương), nên tính toán trên UTC giữ kết quả
 * ổn định bất kể timezone của server hay của trình duyệt.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Số giờ làm việc chuẩn của một ngày công. */
export const HOURS_PER_DAY = 8;

/** Chuẩn hoá về nửa đêm UTC của chính ngày đó. */
export function toUtcDay(value: Date | string): Date {
  const d = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Parse tham số ngày (`YYYY-MM-DD` hoặc ISO đầy đủ); rỗng/không hợp lệ → `fallback`. */
export function parseDayParam(value: string | undefined | null, fallback: Date): Date {
  if (!value) return toUtcDay(fallback);
  const ms = Date.parse(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(ms)) return toUtcDay(fallback);
  return toUtcDay(new Date(ms));
}

/** `YYYY-MM-DD` theo UTC. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Thứ Hai của tuần chứa `d` (tuần bắt đầu Thứ Hai — quy ước Việt Nam). */
export function startOfWeek(d: Date): Date {
  const day = toUtcDay(d);
  const dow = day.getUTCDay(); // 0=CN … 6=T7
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

/** Ngày làm việc = Thứ Hai → Thứ Sáu (ngày lễ/nghỉ xử lý riêng qua TimeOff). */
export function isWorkingDay(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** Danh sách ngày (nửa đêm UTC) từ `from` đến `to`, bao gồm hai đầu. */
export function eachDay(from: Date, to: Date, maxDays = 400): Date[] {
  const out: Date[] = [];
  for (let d = toUtcDay(from); d <= to && out.length < maxDays; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Số ngày làm việc trong đoạn [from, to] (bao gồm hai đầu). Trả 0 nếu đoạn rỗng. */
export function countWorkingDays(from: Date, to: Date, maxDays = 400): number {
  if (to < from) return 0;
  let n = 0;
  let scanned = 0;
  for (let d = toUtcDay(from); d <= to && scanned < maxDays; d = addDays(d, 1), scanned++) {
    if (isWorkingDay(d)) n++;
  }
  return n;
}

/** Nhãn tuần ngắn gọn cho UI: `24/07 – 30/07`. */
export function weekLabel(monday: Date): string {
  const end = addDays(monday, 6);
  const dm = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${dm(monday)} – ${dm(end)}`;
}

/** Làm tròn 2 chữ số thập phân (giờ hiển thị). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
