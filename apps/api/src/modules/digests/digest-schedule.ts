import type { DigestSchedule } from '@prisma/client';

/** Phần lịch của một báo cáo định kỳ (độ phân giải theo GIỜ địa phương, không phút). */
export interface DigestScheduleFields {
  schedule: DigestSchedule;
  /** 0 = Chủ nhật … 6 = Thứ Bảy (chỉ dùng cho WEEKLY). */
  weekday: number;
  /** 0–23 theo `timezone`. */
  hour: number;
  /** Tên múi giờ IANA. */
  timezone: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts {
  weekday: number;
  hour: number;
  /** Ngày lịch địa phương `YYYY-MM-DD`. */
  day: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // hourCycle h23: nửa đêm là 00 (không phải "24" như hour12:false trên một số engine).
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Thứ/giờ/ngày của `now` theo múi giờ `tz` (ném RangeError nếu `tz` không hợp lệ). */
export function localParts(now: Date, tz: string): LocalParts {
  const p = Object.fromEntries(
    formatterFor(tz)
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return {
    weekday: WEEKDAY_INDEX[p.weekday!] ?? 0,
    hour: Number(p.hour) % 24,
    day: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Hai thời điểm rơi vào cùng một giờ địa phương (cùng ngày + cùng giờ) — chống gửi đôi trong một giờ. */
export function sameLocalHour(a: Date, b: Date, tz: string): boolean {
  const x = localParts(a, tz);
  const y = localParts(b, tz);
  return x.day === y.day && x.hour === y.hour;
}

/**
 * Đến giờ gửi chưa (cron chạy mỗi giờ). DAILY: đúng `hour`; WEEKLY: đúng `weekday` và `hour`;
 * SPRINT_END (theo sự kiện) và MANUAL (nút "Gửi ngay") không bao giờ đến hạn ở cron.
 * Múi giờ hỏng → false (không để một dòng dữ liệu xấu làm hỏng cả vòng cron).
 */
export function isDue(sub: DigestScheduleFields, now: Date): boolean {
  if (sub.schedule !== 'DAILY' && sub.schedule !== 'WEEKLY') return false;
  try {
    const p = localParts(now, sub.timezone);
    if (p.hour !== sub.hour) return false;
    return sub.schedule === 'DAILY' || p.weekday === sub.weekday;
  } catch {
    return false;
  }
}
