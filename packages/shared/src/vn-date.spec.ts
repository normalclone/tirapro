import { describe, expect, it } from 'vitest';
import { formatCalendarDmy, formatVnDateTime, vnDayStamp, vnTodayUtc } from './vn-date';

describe('vn-date', () => {
  it('formatVnDateTime: giờ Việt Nam (UTC+7), 00:00 không thành 24:00', () => {
    expect(formatVnDateTime('2026-10-01T10:30:00.000Z')).toBe('01/10/2026 17:30');
    expect(formatVnDateTime(new Date('2026-10-02T17:00:00Z'))).toBe('03/10/2026 00:00');
    expect(formatVnDateTime(null)).toBe('');
    expect(formatVnDateTime('hỏng')).toBe('');
  });
  it('formatCalendarDmy: ngày lịch không lệch', () => {
    expect(formatCalendarDmy('2026-10-09T00:00:00.000Z')).toBe('09/10/2026');
    expect(formatCalendarDmy(null)).toBe('');
  });
  it('vnDayStamp / vnTodayUtc: 00:00-07:00 thứ Hai giờ VN vẫn là thứ Hai dù UTC còn Chủ nhật', () => {
    const sunUtc = new Date('2026-10-18T20:00:00Z'); // 03:00 thứ Hai 19/10 giờ VN
    expect(vnDayStamp(sunUtc)).toBe('20261019');
    expect(vnTodayUtc(sunUtc).toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(vnDayStamp(new Date('2026-10-18T16:59:00Z'))).toBe('20261018');
  });
});
