/**
 * Tính lịch chạy kế tiếp cho việc lặp lại. Thuần hàm (không phụ thuộc Nest/Prisma)
 * để dễ suy luận & test. Mốc thời gian theo giờ máy chủ.
 */

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface RecurrenceConfig {
  freq: Freq;
  interval: number;
  weekday: number | null;
  monthDay: number | null;
  hour: number;
}

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max);

/** Ngày `monthDay` của tháng (year, monthIndex) — tự lùi về ngày cuối nếu tháng ngắn hơn. */
function atMonthDay(year: number, monthIndex: number, monthDay: number, hour: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, clamp(monthDay, 1, lastDay), hour, 0, 0, 0);
}

/**
 * Lần chạy kế tiếp STRICTLY sau `from`.
 * - DAILY: mỗi `interval` ngày, đúng giờ `hour`.
 * - WEEKLY: thứ `weekday` gần nhất sau `from`, rồi cộng thêm (interval-1) tuần.
 * - MONTHLY: ngày `monthDay` của tháng kế tiếp phù hợp, rồi cộng thêm (interval-1) tháng.
 */
export function computeNextRun(cfg: RecurrenceConfig, from: Date = new Date()): Date {
  const hour = clamp(Math.trunc(cfg.hour ?? 8), 0, 23);
  const interval = Math.max(1, Math.trunc(cfg.interval || 1));

  if (cfg.freq === 'DAILY') {
    const d = new Date(from.getTime());
    d.setHours(hour, 0, 0, 0);
    while (d.getTime() <= from.getTime()) d.setDate(d.getDate() + interval);
    return d;
  }

  if (cfg.freq === 'WEEKLY') {
    const weekday = clamp(Math.trunc(cfg.weekday ?? 1), 0, 6);
    const d = new Date(from.getTime());
    d.setHours(hour, 0, 0, 0);
    d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
    if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 7);
    if (interval > 1) d.setDate(d.getDate() + (interval - 1) * 7);
    return d;
  }

  const monthDay = clamp(Math.trunc(cfg.monthDay ?? 1), 1, 31);
  let year = from.getFullYear();
  let month = from.getMonth();
  let d = atMonthDay(year, month, monthDay, hour);
  if (d.getTime() <= from.getTime()) {
    month += 1;
    d = atMonthDay(year, month, monthDay, hour);
  }
  if (interval > 1) {
    month += interval - 1;
    d = atMonthDay(year, month, monthDay, hour);
  }
  return d;
}

/**
 * Chống "dồn lịch": nếu máy chủ tắt lâu, nextRunAt có thể tụt lại rất xa.
 * Sau khi chạy, luôn nhảy tới mốc kế tiếp sau THỜI ĐIỂM HIỆN TẠI (không chạy bù nhiều lần).
 */
export function nextRunAfterRun(cfg: RecurrenceConfig, now: Date = new Date()): Date {
  return computeNextRun(cfg, now);
}
