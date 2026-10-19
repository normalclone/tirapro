import { describe, expect, it } from 'vitest';
import {
  fmtDate,
  fmtDateTime,
  fmtDayMonth,
  fmtLongDate,
  fmtMonthYear,
  fmtRelative,
  monthAxisLabel,
  toDateInput,
  toDateTimeInput,
} from './dateFormat';

describe('fmtDate / fmtDateTime', () => {
  it('dd/MM/yyyy có đệm số 0', () => {
    expect(fmtDate(new Date(2026, 7, 5))).toBe('05/08/2026');
    expect(fmtDateTime(new Date(2026, 7, 5, 9, 7))).toBe('05/08/2026 09:07');
  });
  it('chuỗi yyyy-MM-dd thuần không lệch ngày theo múi giờ', () => {
    expect(fmtDate('2026-08-05')).toBe('05/08/2026');
  });
  it('rỗng / không hợp lệ → —', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('abc')).toBe('—');
    expect(fmtDateTime(undefined)).toBe('—');
  });
});

describe('fmtRelative', () => {
  const now = new Date(2026, 9, 15, 14, 0, 0);
  it('tiếng Việt, có hậu tố "trước"', () => {
    expect(fmtRelative(new Date(2026, 9, 15, 9, 0, 0), now)).toBe('khoảng 5 giờ trước');
    expect(fmtRelative(new Date(2026, 9, 15, 13, 58, 0), now)).toBe('2 phút trước');
  });
  it('dưới một phút => "vừa xong" (không phải "dưới 1 phút trước")', () => {
    expect(fmtRelative(new Date(2026, 9, 15, 13, 59, 50), now)).toBe('vừa xong');
    expect(fmtRelative(new Date(2026, 9, 15, 13, 59, 0), now)).toBe('1 phút trước');
  });
  it('không bao giờ ra tiếng Anh', () => {
    expect(fmtRelative(new Date(2026, 9, 15, 13, 59, 50), now)).not.toMatch(/ago|minute|hour/);
  });
  it('không hợp lệ → chuỗi rỗng', () => expect(fmtRelative('x', now)).toBe(''));
});

describe('toDateInput / toDateTimeInput', () => {
  it('khoá giá trị cho input theo giờ địa phương', () => {
    expect(toDateInput(new Date(2026, 7, 5, 23, 30))).toBe('2026-08-05');
    expect(toDateTimeInput(new Date(2026, 7, 5, 9, 7))).toBe('2026-08-05T09:07');
  });
  it('không hợp lệ → chuỗi rỗng (không ném lỗi)', () => {
    expect(toDateInput(null)).toBe('');
    expect(toDateTimeInput('abc')).toBe('');
  });
});

describe('fmtDayMonth / fmtMonthYear / fmtLongDate', () => {
  it('ngày/tháng rút gọn, có đệm số 0, nhận Date / ISO / yyyy-MM-dd', () => {
    expect(fmtDayMonth(new Date(2026, 9, 17))).toBe('17/10');
    expect(fmtDayMonth('2026-08-05')).toBe('05/08');
    expect(fmtDayMonth(new Date(2026, 7, 5, 9, 0).toISOString())).toBe('05/08');
  });
  it('yyyy-MM-dd thuần không lệch ngày theo múi giờ', () => {
    expect(fmtDayMonth('2026-10-01')).toBe('01/10');
    expect(fmtMonthYear('2026-10-01')).toBe('T10/2026');
    expect(fmtLongDate('2026-10-17')).toBe('Thứ Bảy, 17/10/2026');
  });
  it('tháng/năm: "T10/2026", năm đủ 4 chữ số', () => {
    expect(fmtMonthYear(new Date(2026, 9, 17))).toBe('T10/2026');
    expect(fmtMonthYear(new Date(2027, 0, 1).getTime())).toBe('T1/2027');
  });
  it('ngày dài có thứ tiếng Việt', () => {
    expect(fmtLongDate(new Date(2026, 9, 17))).toBe('Thứ Bảy, 17/10/2026');
    expect(fmtLongDate(new Date(2026, 9, 18))).toBe('Chủ nhật, 18/10/2026');
    expect(fmtLongDate(new Date(2026, 9, 19))).toBe('Thứ Hai, 19/10/2026');
    expect(fmtLongDate(new Date(2026, 9, 21))).toBe('Thứ Tư, 21/10/2026');
  });
  it('không bao giờ ra "thg" hay ISO thô', () => {
    expect(fmtLongDate(new Date(2026, 9, 17))).not.toMatch(/thg/);
    expect(fmtDayMonth('2026-10-17')).not.toMatch(/\d{4}-/);
  });
  it('rỗng / không hợp lệ → —', () => {
    for (const f of [fmtDayMonth, fmtMonthYear, fmtLongDate]) {
      expect(f(null)).toBe('—');
      expect(f('abc')).toBe('—');
    }
  });
});

describe('monthAxisLabel', () => {
  const oct = new Date(2026, 9, 1);
  it('đủ rộng (>= 64px) → T10/2026', () => {
    expect(monthAxisLabel(oct, 240)).toBe('T10/2026');
    expect(monthAxisLabel(oct, 64)).toBe('T10/2026');
  });
  it('vừa (34-63px) → chỉ T10', () => {
    expect(monthAxisLabel(oct, 63)).toBe('T10');
    expect(monthAxisLabel(oct, 40)).toBe('T10');
    expect(monthAxisLabel(oct, 34)).toBe('T10');
  });
  it('quá hẹp (< 34px) → rỗng', () => {
    expect(monthAxisLabel(oct, 33)).toBe('');
    expect(monthAxisLabel(oct, 30)).toBe('');
  });
  it('ngày không hợp lệ → —', () => {
    expect(monthAxisLabel('abc', 240)).toBe('—');
    expect(monthAxisLabel(null, 40)).toBe('—');
  });
});
