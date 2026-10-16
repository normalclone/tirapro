import { describe, expect, it } from 'vitest';
import { barWidthPct, formatHours, formatPercent, qaRangeFrom } from './qaFormat';

describe('formatHours', () => {
  it('phút / giờ / ngày, dấu phẩy thập phân, "—" khi null', () => {
    expect(formatHours(0.75)).toBe('45 phút');
    expect(formatHours(5.2)).toBe('5,2 giờ');
    expect(formatHours(74.4)).toBe('3,1 ngày');
    expect(formatHours(null)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('làm tròn số nguyên, "—" khi null', () => {
    expect(formatPercent(0.1234)).toBe('12%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('barWidthPct', () => {
  it('tỷ lệ theo giá trị lớn nhất; có giá trị thì tối thiểu 2% để còn thấy; 0 hoặc max=0 thì 0', () => {
    expect(barWidthPct(5, 10)).toBe(50);
    expect(barWidthPct(10, 10)).toBe(100);
    expect(barWidthPct(1, 1000)).toBe(2);
    expect(barWidthPct(0, 10)).toBe(0);
    expect(barWidthPct(3, 0)).toBe(0);
  });
});

describe('qaRangeFrom', () => {
  it('ngày bắt đầu (UTC) của kỳ N ngày tính cả hôm nay', () => {
    expect(qaRangeFrom(7, new Date('2026-10-16T05:00:00Z'))).toBe('2026-10-10');
    expect(qaRangeFrom(30, new Date('2026-10-16T23:59:00Z'))).toBe('2026-09-17');
  });
});
