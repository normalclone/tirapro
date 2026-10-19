import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserTimeZone,
  describeSchedule,
  canonicalTimeZone,
  resetTimeZoneChoicesCache,
  timeZoneChoices,
  timeZoneHint,
  timeZoneOptions,
  timeZoneLabel,
  HOUR_OPTIONS,
  TIMEZONE_FALLBACK,
  WEEKDAY_OPTIONS,
  type ScheduleFields,
} from './schedule';

const base: ScheduleFields = {
  schedule: 'WEEKLY',
  weekday: 1,
  hour: 8,
  timezone: 'Asia/Ho_Chi_Minh',
};

describe('describeSchedule', () => {
  it('WEEKLY: thứ + giờ 2 chữ số + múi giờ', () => {
    expect(describeSchedule(base)).toBe('Mỗi thứ Hai, 08:00 · Giờ Việt Nam (UTC+7)');
    expect(describeSchedule({ ...base, weekday: 6, hour: 17 })).toBe(
      'Mỗi thứ Bảy, 17:00 · Giờ Việt Nam (UTC+7)',
    );
  });

  it('WEEKLY chủ nhật không có "thứ" phía trước', () => {
    expect(describeSchedule({ ...base, weekday: 0 })).toBe(
      'Mỗi Chủ nhật, 08:00 · Giờ Việt Nam (UTC+7)',
    );
  });

  it('DAILY: Mỗi ngày, bỏ qua thứ', () => {
    expect(describeSchedule({ ...base, schedule: 'DAILY' })).toBe(
      'Mỗi ngày, 08:00 · Giờ Việt Nam (UTC+7)',
    );
  });

  it('SPRINT_END và MANUAL không có giờ', () => {
    expect(describeSchedule({ ...base, schedule: 'SPRINT_END' })).toBe('Khi kết thúc sprint');
    expect(describeSchedule({ ...base, schedule: 'MANUAL' })).toBe('Chỉ gửi thủ công');
  });
});

describe('tuỳ chọn', () => {
  it('7 ngày bắt đầu từ Thứ Hai (thói quen VN) nhưng giữ số 0=CN…6=T7 của API', () => {
    expect(WEEKDAY_OPTIONS.map((o) => o.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(WEEKDAY_OPTIONS[0]!.label).toBe('Thứ Hai');
    expect(WEEKDAY_OPTIONS[6]!.label).toBe('Chủ nhật');
  });

  it('24 giờ dạng HH:00', () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toEqual({ value: 0, label: '00:00' });
    expect(HOUR_OPTIONS[23]).toEqual({ value: 23, label: '23:00' });
  });

  it('browserTimeZone đổi tên cũ Asia/Saigon thành Asia/Ho_Chi_Minh', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Asia/Saigon',
    } as Intl.ResolvedDateTimeFormatOptions);
    try {
      expect(browserTimeZone()).toBe('Asia/Ho_Chi_Minh');
    } finally {
      spy.mockRestore();
    }
  });

  it('browserTimeZone trả múi giờ IANA hợp lệ (hoặc giá trị dự phòng)', () => {
    const tz = browserTimeZone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
    expect(TIMEZONE_FALLBACK).toContain('Asia/Ho_Chi_Minh');
  });
});

describe('timeZoneLabel', () => {
  const JAN = new Date('2026-01-15T00:00:00Z');
  const JUL = new Date('2026-07-15T00:00:00Z');

  it('Asia/Ho_Chi_Minh (và alias Asia/Saigon) → "Giờ Việt Nam (UTC+7)", không còn gạch dưới', () => {
    expect(timeZoneLabel('Asia/Ho_Chi_Minh')).toBe('Giờ Việt Nam (UTC+7)');
    expect(timeZoneLabel('Asia/Saigon')).toBe('Giờ Việt Nam (UTC+7)');
  });

  it('múi giờ khác: thay _ bằng khoảng trắng + độ lệch UTC', () => {
    expect(timeZoneLabel('Asia/Tokyo')).toBe('Asia/Tokyo (UTC+9)');
    expect(timeZoneLabel('America/Argentina/Buenos_Aires')).toBe(
      'America/Argentina/Buenos Aires (UTC-3)',
    );
  });

  it('độ lệch lẻ giờ giữ phút; UTC và GMT-0 không có số', () => {
    expect(timeZoneLabel('Asia/Kolkata')).toBe('Asia/Kolkata (UTC+5:30)');
    expect(timeZoneLabel('Asia/Kathmandu')).toBe('Asia/Kathmandu (UTC+5:45)');
    expect(timeZoneLabel('UTC')).toBe('UTC');
  });

  it('độ lệch theo thời điểm (giờ mùa hè)', () => {
    expect(timeZoneLabel('America/New_York', JAN)).toBe('America/New York (UTC-5)');
    expect(timeZoneLabel('America/New_York', JUL)).toBe('America/New York (UTC-4)');
  });

  it('độ lệch 0 ở múi giờ có tên (mùa đông Luân Đôn) ghi "UTC" trong ngoặc', () => {
    expect(timeZoneLabel('Europe/London', JAN)).toBe('Europe/London (UTC)');
  });

  it('múi giờ không hợp lệ: chỉ làm đẹp tên, không ném lỗi', () => {
    expect(timeZoneLabel('Khong/Ton_Tai')).toBe('Khong/Ton Tai');
    expect(timeZoneLabel('')).toBe('');
  });
});

describe('timeZoneHint (từ khoá tìm trong ô chọn)', () => {
  it('giờ Việt Nam tìm được bằng tên thành phố; múi giờ khác không cần gợi ý', () => {
    expect(timeZoneHint('Asia/Ho_Chi_Minh')).toBe('Hà Nội · Hồ Chí Minh');
    expect(timeZoneHint('Asia/Tokyo')).toBeUndefined();
  });
});

describe('timeZoneOptions', () => {
  it('đổi tên cũ sang tên chuẩn và bỏ trùng (Asia/Saigon + Asia/Ho_Chi_Minh chỉ còn một dòng), luôn có UTC', () => {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const orig = intl.supportedValuesOf;
    intl.supportedValuesOf = () => [
      'Asia/Saigon',
      'Asia/Ho_Chi_Minh',
      'Asia/Calcutta',
      'Asia/Tokyo',
    ];
    try {
      expect(timeZoneOptions()).toEqual(['Asia/Ho_Chi_Minh', 'Asia/Kolkata', 'Asia/Tokyo', 'UTC']);
    } finally {
      intl.supportedValuesOf = orig;
    }
  });
});

describe('canonicalTimeZone', () => {
  it('đổi tên cũ sang tên chuẩn, tên khác giữ nguyên', () => {
    expect(canonicalTimeZone('Asia/Saigon')).toBe('Asia/Ho_Chi_Minh');
    expect(canonicalTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(canonicalTimeZone('Asia/Katmandu')).toBe('Asia/Kathmandu');
    expect(canonicalTimeZone('Asia/Rangoon')).toBe('Asia/Yangon');
    expect(canonicalTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });
});

describe('timeZoneChoices', () => {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const orig = intl.supportedValuesOf;
  const LIST = ['Asia/Saigon', 'Asia/Calcutta', 'Asia/Tokyo', 'Europe/London'];
  const labelsOf = (cs: { label: string }[]) => cs.map((c) => c.label);

  beforeEach(() => {
    intl.supportedValuesOf = () => LIST;
    resetTimeZoneChoicesCache();
  });
  afterEach(() => {
    intl.supportedValuesOf = orig;
    resetTimeZoneChoicesCache();
    vi.restoreAllMocks();
  });

  it('giá trị đang lưu là tên cũ (Asia/Saigon, Asia/Calcutta): không thêm dòng, không có hai nhãn trùng', () => {
    for (const current of ['Asia/Saigon', 'Asia/Ho_Chi_Minh', 'Asia/Calcutta', 'Asia/Kolkata']) {
      const cs = timeZoneChoices(current);
      const labels = labelsOf(cs);
      expect(new Set(labels).size, current).toBe(labels.length);
      expect(cs.map((c) => c.value)).toEqual([
        'Asia/Ho_Chi_Minh',
        'Asia/Kolkata',
        'Asia/Tokyo',
        'Europe/London',
        'UTC',
      ]);
    }
  });

  it('giá trị lưu không có trong danh sách (kể cả tên cũ) được đổi sang tên chuẩn rồi thêm lên đầu', () => {
    const cs = timeZoneChoices('Asia/Katmandu');
    expect(cs[0]).toMatchObject({ value: 'Asia/Kathmandu', label: 'Asia/Kathmandu (UTC+5:45)' });
    expect(cs).toHaveLength(6);
  });

  it('danh sách chung dựng MỘT lần: lần gọi sau không tạo thêm Intl.DateTimeFormat', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    const first = timeZoneChoices('Asia/Tokyo');
    const built = spy.mock.calls.length;
    expect(built).toBeGreaterThanOrEqual(LIST.length);
    const second = timeZoneChoices('Asia/Tokyo');
    expect(spy.mock.calls.length).toBe(built);
    expect(second).toBe(first);
    // Giá trị lạ chỉ tốn đúng một nhãn thêm, không dựng lại cả danh sách.
    timeZoneChoices('Khong/Co_That');
    expect(spy.mock.calls.length - built).toBeLessThanOrEqual(2);
  });

  it('nhãn giờ Việt Nam kèm hint để tìm bằng tên thành phố', () => {
    const vn = timeZoneChoices().find((c) => c.value === 'Asia/Ho_Chi_Minh');
    expect(vn).toEqual({
      value: 'Asia/Ho_Chi_Minh',
      label: 'Giờ Việt Nam (UTC+7)',
      hint: 'Hà Nội · Hồ Chí Minh',
    });
  });
});

describe('timeZoneLabel — dấu trừ Unicode', () => {
  it('độ lệch ghi bằng U+2212 vẫn ra "UTC-5"', () => {
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockReturnValue([{ type: 'timeZoneName', value: 'GMT\u221205:00' }]);
    expect(timeZoneLabel('America/Bogota')).toBe('America/Bogota (UTC-5)');
    spy.mockRestore();
  });
});
