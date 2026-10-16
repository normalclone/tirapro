import type { DigestSchedule } from './api';

/** Phần lịch của một báo cáo định kỳ (khớp cột API: weekday 0=CN…6=T7, hour 0–23, múi giờ IANA). */
export interface ScheduleFields {
  schedule: DigestSchedule;
  weekday: number;
  hour: number;
  timezone: string;
}

const WEEKDAY_LABEL = [
  'Chủ nhật',
  'Thứ Hai',
  'Thứ Ba',
  'Thứ Tư',
  'Thứ Năm',
  'Thứ Sáu',
  'Thứ Bảy',
] as const;

/** Thứ Hai đứng đầu (thói quen người Việt) nhưng `value` giữ nguyên quy ước của API (0 = Chủ nhật). */
export const WEEKDAY_OPTIONS: { value: number; label: string }[] = [1, 2, 3, 4, 5, 6, 0].map(
  (value) => ({ value, label: WEEKDAY_LABEL[value]! }),
);

export const HOUR_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: 24 },
  (_, value) => ({ value, label: `${String(value).padStart(2, '0')}:00` }),
);

/** Danh sách dự phòng khi trình duyệt không có `Intl.supportedValuesOf`. */
export const TIMEZONE_FALLBACK = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

/** Tên cũ (alias) mà một số trình duyệt/hệ điều hành vẫn trả → tên IANA chuẩn (hiển thị đúng, khớp danh sách chọn). */
const TZ_ALIAS: Record<string, string> = {
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
};

/** Múi giờ của trình duyệt (đề xuất mặc định khi tạo báo cáo); lỗi → giờ Việt Nam. */
export function browserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh';
    return TZ_ALIAS[tz] ?? tz;
  } catch {
    return 'Asia/Ho_Chi_Minh';
  }
}

export function timeZoneOptions(): string[] {
  try {
    const all = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    if (all && all.length > 0) return all.includes('UTC') ? all : [...all, 'UTC'];
  } catch {
    /* rơi về danh sách dự phòng */
  }
  return TIMEZONE_FALLBACK;
}

/** "Mỗi thứ Hai, 08:00 (Asia/Ho_Chi_Minh)" · "Mỗi ngày, 08:00 (…)" · "Khi kết thúc sprint" · "Chỉ gửi thủ công". */
export function describeSchedule(s: ScheduleFields): string {
  if (s.schedule === 'SPRINT_END') return 'Khi kết thúc sprint';
  if (s.schedule === 'MANUAL') return 'Chỉ gửi thủ công';
  const time = `${String(s.hour).padStart(2, '0')}:00 (${s.timezone})`;
  if (s.schedule === 'DAILY') return `Mỗi ngày, ${time}`;
  const day = WEEKDAY_LABEL[s.weekday] ?? WEEKDAY_LABEL[1];
  return `Mỗi ${s.weekday === 0 ? day : day.replace('Thứ', 'thứ')}, ${time}`;
}
