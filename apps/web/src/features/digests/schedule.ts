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
    if (all && all.length > 0) {
      // Trình duyệt vẫn liệt kê tên cũ (Asia/Saigon…) → đổi sang tên chuẩn rồi bỏ trùng, nếu không ô chọn có hai dòng cùng nhãn.
      const canon = [...new Set(all.map((z) => TZ_ALIAS[z] ?? z))];
      return canon.includes('UTC') ? canon : [...canon, 'UTC'];
    }
  } catch {
    /* rơi về danh sách dự phòng */
  }
  return TIMEZONE_FALLBACK;
}

/** "UTC+7", "UTC+5:30", "UTC-3"; "UTC" khi độ lệch 0. `null` nếu trình duyệt không biết múi giờ này. */
function utcOffsetText(timeZone: string, at: Date): string | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!part) return null;
    if (part === 'GMT') return 'UTC';
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part);
    if (!m) return null;
    const minutes = m[3] && m[3] !== '00' ? `:${m[3]}` : '';
    if (Number(m[2]) === 0 && !minutes) return 'UTC';
    return `UTC${m[1]}${Number(m[2])}${minutes}`;
  } catch {
    return null;
  }
}

/**
 * Tên múi giờ để HIỂN THỊ (giá trị lưu/gửi API vẫn là tên IANA): "Giờ Việt Nam (UTC+7)" cho Asia/Ho_Chi_Minh,
 * còn lại bỏ gạch dưới + thêm độ lệch UTC hiện tại: "Asia/Tokyo (UTC+9)", "America/New York (UTC-5)".
 * Tên lạ (trình duyệt không nhận) chỉ được làm đẹp, không ném lỗi.
 */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const tz = TZ_ALIAS[timeZone] ?? timeZone;
  const offset = utcOffsetText(tz, at);
  if (tz === 'Asia/Ho_Chi_Minh') return `Giờ Việt Nam (${offset ?? 'UTC+7'})`;
  const name = tz.replace(/_/g, ' ');
  if (!offset) return name;
  return offset === 'UTC' && name === 'UTC' ? name : `${name} (${offset})`;
}

/** Từ khoá phụ để tìm trong ô chọn múi giờ: "Giờ Việt Nam" không chứa chữ "Ho Chi Minh" nên cần gợi ý tên thành phố. */
export function timeZoneHint(timeZone: string): string | undefined {
  return (TZ_ALIAS[timeZone] ?? timeZone) === 'Asia/Ho_Chi_Minh'
    ? 'Hà Nội · Hồ Chí Minh'
    : undefined;
}

/** "Mỗi thứ Hai, 08:00 · Giờ Việt Nam (UTC+7)" · "Mỗi ngày, 08:00 · Asia/Tokyo (UTC+9)" · "Khi kết thúc sprint" · "Chỉ gửi thủ công". */
export function describeSchedule(s: ScheduleFields): string {
  if (s.schedule === 'SPRINT_END') return 'Khi kết thúc sprint';
  if (s.schedule === 'MANUAL') return 'Chỉ gửi thủ công';
  const time = `${String(s.hour).padStart(2, '0')}:00 · ${timeZoneLabel(s.timezone)}`;
  if (s.schedule === 'DAILY') return `Mỗi ngày, ${time}`;
  const day = WEEKDAY_LABEL[s.weekday] ?? WEEKDAY_LABEL[1];
  return `Mỗi ${s.weekday === 0 ? day : day.replace('Thứ', 'thứ')}, ${time}`;
}
