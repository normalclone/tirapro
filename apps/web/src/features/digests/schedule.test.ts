import { describe, expect, it, vi } from 'vitest';
import {
  browserTimeZone,
  describeSchedule,
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
    expect(describeSchedule(base)).toBe('Mỗi thứ Hai, 08:00 (Asia/Ho_Chi_Minh)');
    expect(describeSchedule({ ...base, weekday: 6, hour: 17 })).toBe(
      'Mỗi thứ Bảy, 17:00 (Asia/Ho_Chi_Minh)',
    );
  });

  it('WEEKLY chủ nhật không có "thứ" phía trước', () => {
    expect(describeSchedule({ ...base, weekday: 0 })).toBe(
      'Mỗi Chủ nhật, 08:00 (Asia/Ho_Chi_Minh)',
    );
  });

  it('DAILY: Mỗi ngày, bỏ qua thứ', () => {
    expect(describeSchedule({ ...base, schedule: 'DAILY' })).toBe(
      'Mỗi ngày, 08:00 (Asia/Ho_Chi_Minh)',
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
