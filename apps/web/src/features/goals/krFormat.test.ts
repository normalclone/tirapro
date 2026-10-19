import { describe, expect, it } from 'vitest';
import { describeDelta, formatKrValue, krSummary } from './krFormat';

describe('formatKrValue', () => {
  it('số + nhãn đơn vị', () => {
    expect(formatKrValue(4, 'NUMBER', 'bug')).toBe('4 bug');
    expect(formatKrValue(4, 'NUMBER', null)).toBe('4');
    expect(formatKrValue(4.256, 'NUMBER', '')).toBe('4.26');
  });

  it('PERCENT giữ định dạng cũ và bỏ qua nhãn đơn vị', () => {
    expect(formatKrValue(75, 'PERCENT', 'x')).toBe('75%');
    expect(formatKrValue(33.33, 'PERCENT', null)).toBe('33.3%');
  });

  it('CURRENCY: phân tách nghìn theo locale, nhãn nối sau', () => {
    expect(formatKrValue(1500, 'CURRENCY', 'đ')).toMatch(/^1\D?500 đ$/);
  });
});

describe('describeDelta', () => {
  it('giảm dùng dấu trừ typographic, tăng có dấu +', () => {
    expect(describeDelta(6, 4)).toBe('−2');
    expect(describeDelta(4, 7)).toBe('+3');
    expect(describeDelta(4, 4)).toBe('0');
  });

  it('không có giá trị trước → chuỗi rỗng', () => {
    expect(describeDelta(null, 4)).toBe('');
  });

  it('làm tròn nhiễu số thực và thêm % cho đơn vị phần trăm', () => {
    expect(describeDelta(0.1, 0.3)).toBe('+0.2');
    expect(describeDelta(10, 25, { unit: 'PERCENT' })).toBe('+15%');
  });
});

describe('krSummary', () => {
  it('Bắt đầu → hiện tại / mục tiêu + nhãn', () => {
    expect(
      krSummary({
        startValue: 6,
        currentValue: 4,
        targetValue: 0,
        unit: 'NUMBER',
        unitLabel: 'bug',
      }),
    ).toBe('Bắt đầu 6 → 4 / 0 bug');
  });

  it('không nhãn / phần trăm', () => {
    expect(
      krSummary({
        startValue: 0,
        currentValue: 40,
        targetValue: 100,
        unit: 'PERCENT',
        unitLabel: 'x',
      }),
    ).toBe('Bắt đầu 0% → 40% / 100%');
    expect(
      krSummary({
        startValue: 0,
        currentValue: 3,
        targetValue: 10,
        unit: 'NUMBER',
        unitLabel: null,
      }),
    ).toBe('Bắt đầu 0 → 3 / 10');
  });
});
