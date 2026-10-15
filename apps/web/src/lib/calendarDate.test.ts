import { describe, expect, it } from 'vitest';
import { calendarDate, formatCalendarDmy } from './calendarDate';

describe('calendarDate', () => {
  it('dd/MM/yyyy lấy đúng ngày lịch, không phụ thuộc múi giờ (00:00Z và 23:59Z cùng ngày)', () => {
    expect(formatCalendarDmy('2026-10-05T00:00:00.000Z')).toBe('05/10/2026');
    expect(formatCalendarDmy('2026-10-05T23:59:59.999Z')).toBe('05/10/2026');
    expect(formatCalendarDmy('2026-10-05')).toBe('05/10/2026');
  });
  it('null/undefined/rỗng => chuỗi rỗng', () => {
    expect(formatCalendarDmy(null)).toBe('');
    expect(formatCalendarDmy(undefined)).toBe('');
    expect(formatCalendarDmy('')).toBe('');
  });
  it('calendarDate dựng ngày địa phương đúng ngày/tháng/năm', () => {
    const d = calendarDate('2026-10-05T00:00:00.000Z');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 5]);
  });
});
