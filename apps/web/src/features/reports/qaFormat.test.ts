import { describe, expect, it } from 'vitest';
import { barWidthPct, formatHours, formatPercent, qaRange, shouldWarnReopen } from './qaFormat';

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

describe('qaRange', () => {
  // Dựng bằng thành phần địa phương nên kết quả đúng trong MỌI múi giờ của máy chạy test.
  const now = new Date(2026, 9, 16, 3, 0, 0); // 16/10/2026 03:00 giờ địa phương (trước 07:00)

  it('kỳ N ngày: từ 00:00 địa phương của ngày đầu tới 23:59:59.999 địa phương của hôm nay', () => {
    const r = qaRange(7, now);
    const from = new Date(r.from);
    const to = new Date(r.to);
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 9, 10]);
    expect([from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds()]).toEqual(
      [0, 0, 0, 0],
    );
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2026, 9, 16]);
    expect([to.getHours(), to.getMinutes(), to.getSeconds(), to.getMilliseconds()]).toEqual([
      23, 59, 59, 999,
    ]);
  });

  it('gửi ISO có múi giờ (Z) để máy chủ dùng nguyên văn, không còn YYYY-MM-DD cắt theo UTC', () => {
    const r = qaRange(30, now);
    expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(r.to).toMatch(/Z$/);
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBeGreaterThan(29 * 86_400_000);
  });

  it('00:00-07:00 giờ địa phương vẫn thuộc hôm nay: kỳ 1 ngày bắt đầu đúng 00:00 hôm nay', () => {
    const r = qaRange(1, new Date(2026, 9, 16, 0, 30, 0));
    expect(new Date(r.from).getDate()).toBe(16);
    expect(new Date(r.from).getHours()).toBe(0);
  });
});

describe('shouldWarnReopen', () => {
  it('chỉ cảnh báo khi tỷ lệ >= 20% VÀ đủ mẫu (>= 10 bug đóng)', () => {
    expect(shouldWarnReopen(0.25, 4)).toBe(false);
    expect(shouldWarnReopen(0.1, 40)).toBe(false);
    expect(shouldWarnReopen(0.2, 10)).toBe(true);
    expect(shouldWarnReopen(null, 50)).toBe(false);
  });
});
