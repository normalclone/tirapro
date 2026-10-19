import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RANGE_ERROR,
  dateRangeError,
  dateRangeSummary,
  inclusiveDayCount,
} from './dateRange';

const now = new Date(2026, 9, 20, 9); // 20/10/2026 giờ địa phương

describe('inclusiveDayCount — đếm cả ngày đầu lẫn ngày cuối (như Gantt/Kế hoạch/"hết hôm nay" của sprint)', () => {
  it('cùng một ngày = 1', () => expect(inclusiveDayCount('2026-10-20', '2026-10-20')).toBe(1));
  it('20/10 → 02/11 qua tháng = 14', () =>
    expect(inclusiveDayCount('2026-10-20', '2026-11-02')).toBe(14));
  it('qua năm nhuận: 28/02 → 01/03/2028 = 3', () =>
    expect(inclusiveDayCount('2028-02-28', '2028-03-01')).toBe(3));
  it('qua năm thường: 28/02 → 01/03/2026 = 2', () =>
    expect(inclusiveDayCount('2026-02-28', '2026-03-01')).toBe(2));
  it('qua năm: 30/12 → 02/01 = 4', () =>
    expect(inclusiveDayCount('2026-12-30', '2027-01-02')).toBe(4));
  it('không lệch khi múi giờ máy có giờ mùa hè (tính theo ngày UTC)', () => {
    // 2026-03-08 → 2026-03-09 là ngày chuyển giờ ở Mỹ: vẫn đúng 2 ngày.
    expect(inclusiveDayCount('2026-03-08', '2026-03-09')).toBe(2);
    expect(inclusiveDayCount('2026-11-01', '2026-11-02')).toBe(2);
  });
  it('nhận cả ISO đầy đủ (lấy phần ngày)', () =>
    expect(inclusiveDayCount('2026-10-20T00:00:00.000Z', '2026-11-02T00:00:00.000Z')).toBe(14));
  it('null khi thiếu, sai, hoặc kết thúc trước bắt đầu', () => {
    expect(inclusiveDayCount('', '2026-10-20')).toBeNull();
    expect(inclusiveDayCount('2026-10-20', '')).toBeNull();
    expect(inclusiveDayCount('', '')).toBeNull();
    expect(inclusiveDayCount('2026-02-31', '2026-03-05')).toBeNull();
    expect(inclusiveDayCount('abc', '2026-03-05')).toBeNull();
    expect(inclusiveDayCount('2026-10-20', '2026-10-19')).toBeNull();
  });
});

describe('dateRangeError', () => {
  it('kết thúc < bắt đầu → câu mặc định', () =>
    expect(dateRangeError('2026-10-20', '2026-10-19')).toBe(DEFAULT_RANGE_ERROR));
  it('câu riêng của nơi dùng', () =>
    expect(dateRangeError('2026-10-20', '2026-10-19', 'Ngày mục tiêu sớm quá')).toBe(
      'Ngày mục tiêu sớm quá',
    ));
  it('bằng nhau, hợp lệ → null', () => {
    expect(dateRangeError('2026-10-20', '2026-10-20')).toBeNull();
    expect(dateRangeError('2026-10-20', '2026-11-02')).toBeNull();
  });
  it('trống một đầu hoặc cả hai → null (không thêm luật bắt buộc)', () => {
    expect(dateRangeError('', '2026-10-20')).toBeNull();
    expect(dateRangeError('2026-10-20', '')).toBeNull();
    expect(dateRangeError('', '')).toBeNull();
  });
  it('mặc định cố định', () =>
    expect(DEFAULT_RANGE_ERROR).toBe('Ngày kết thúc không được trước ngày bắt đầu'));
});

describe('dateRangeSummary', () => {
  it('"14 ngày · 20/10 – 02/11" khi cả hai đầu cùng năm hiện tại', () =>
    expect(dateRangeSummary('2026-10-20', '2026-11-02', now)).toBe('14 ngày · 20/10 – 02/11'));
  it('khác năm hiện tại → đủ năm cả hai đầu', () => {
    expect(dateRangeSummary('2026-12-20', '2027-01-02', now)).toBe(
      '14 ngày · 20/12/2026 – 02/01/2027',
    );
    expect(dateRangeSummary('2025-10-20', '2025-10-22', now)).toBe(
      '3 ngày · 20/10/2025 – 22/10/2025',
    );
  });
  it('cùng một ngày → "1 ngày · 20/10"', () =>
    expect(dateRangeSummary('2026-10-20', '2026-10-20', now)).toBe('1 ngày · 20/10'));
  it('trống, thiếu một đầu, hoặc kết thúc < bắt đầu → rỗng', () => {
    expect(dateRangeSummary('', '', now)).toBe('');
    expect(dateRangeSummary('2026-10-20', '', now)).toBe('');
    expect(dateRangeSummary('', '2026-10-20', now)).toBe('');
    expect(dateRangeSummary('2026-10-20', '2026-10-19', now)).toBe('');
  });
});
