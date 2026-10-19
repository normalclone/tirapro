import { describe, expect, it } from 'vitest';
import {
  formatCalendarDmy,
  formatVnDateTime,
  overdueCutoff,
  vnDayStamp,
  vnTodayUtc,
} from './vn-date';

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

describe('overdueCutoff — "quá hạn" theo ngày Việt Nam', () => {
  const overdue = (dueDate: string, now: string) =>
    new Date(dueDate) < overdueCutoff(new Date(now));

  it('hạn HÔM NAY lúc 09:00 VN (02:00Z) chưa quá hạn', () => {
    expect(overdueCutoff(new Date('2026-10-16T02:00:00Z')).toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
    expect(overdue('2026-10-16T00:00:00Z', '2026-10-16T02:00:00Z')).toBe(false);
  });

  it('hạn HÔM QUA là quá hạn', () => {
    expect(overdue('2026-10-15T00:00:00Z', '2026-10-16T02:00:00Z')).toBe(true);
  });

  it('06:59 VN (23:59Z hôm trước) vẫn là ngày VN đó: hạn ngày đó chưa quá hạn, hạn hôm trước quá hạn', () => {
    const now = '2026-10-15T23:59:00Z'; // = 06:59 ngày 16/10 giờ VN
    expect(overdueCutoff(new Date(now)).toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(overdue('2026-10-16T00:00:00Z', now)).toBe(false);
    expect(overdue('2026-10-15T00:00:00Z', now)).toBe(true);
  });

  it('23:59 VN cuối ngày vẫn chưa quá hạn; 00:00 VN ngày sau thì quá hạn', () => {
    expect(overdue('2026-10-16T00:00:00Z', '2026-10-16T16:59:00Z')).toBe(false); // 23:59 VN
    expect(overdue('2026-10-16T00:00:00Z', '2026-10-16T17:00:00Z')).toBe(true); // 00:00 VN 17/10
  });

  it('cùng giá trị với vnTodayUtc', () => {
    const now = new Date('2026-03-01T20:00:00Z');
    expect(overdueCutoff(now).getTime()).toBe(vnTodayUtc(now).getTime());
  });
});
