import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateTime, fmtRelative, toDateInput, toDateTimeInput } from './dateFormat';

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
