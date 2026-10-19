import { describe, expect, it } from 'vitest';
import { groupDaysByMonth } from './groupDaysByMonth';

const run = (start: Date, n: number) =>
  Array.from(
    { length: n },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );

describe('groupDaysByMonth', () => {
  it('mảng rỗng → rỗng', () => {
    expect(groupDaysByMonth([])).toEqual([]);
  });
  it('một tháng trọn vẹn', () => {
    const g = groupDaysByMonth(run(new Date(2026, 9, 1), 31));
    expect(g).toHaveLength(1);
    expect(g[0]!.span).toBe(31);
    expect(g[0]!.start).toEqual(new Date(2026, 9, 1));
  });
  it('khoảng ngắn vắt qua tháng: tháng đầu 1 ngày, tháng sau 2 ngày', () => {
    const g = groupDaysByMonth(run(new Date(2026, 9, 31), 3));
    expect(g.map((m) => m.span)).toEqual([1, 2]);
    expect(g[1]!.start).toEqual(new Date(2026, 10, 1));
  });
  it('phân biệt cùng tháng khác năm', () => {
    const days = [new Date(2026, 0, 31), new Date(2027, 0, 1)];
    expect(groupDaysByMonth(days).map((m) => m.span)).toEqual([1, 1]);
  });
  it('tổng span bằng số ngày', () => {
    const days = run(new Date(2026, 10, 20), 70);
    expect(groupDaysByMonth(days).reduce((a, m) => a + m.span, 0)).toBe(70);
  });
});
