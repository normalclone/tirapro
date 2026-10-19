import { describe, expect, it } from 'vitest';
import { CHART_MARGIN, yAxisWidth } from './chartAxis';

describe('yAxisWidth', () => {
  it('tối thiểu 36 cho số ≤ 3 chữ số', () => {
    expect(yAxisWidth([])).toBe(36);
    expect(yAxisWidth([0, 7, 100])).toBe(36);
  });
  it('rộng ra theo số chữ số lớn nhất (không cắt nhãn)', () => {
    expect(yAxisWidth([1, 12_345])).toBe(5 * 7 + 14);
    expect(yAxisWidth([1_000_000])).toBe(7 * 7 + 14);
  });
  it('bỏ qua giá trị không hữu hạn/âm không làm hỏng', () => {
    expect(yAxisWidth([Number.NaN, -250, Number.POSITIVE_INFINITY])).toBe(36);
  });
});
describe('CHART_MARGIN', () => {
  it('không dùng margin trái âm (đó là nguyên nhân nhãn trục bị cắt)', () => {
    expect(CHART_MARGIN.left).toBeGreaterThanOrEqual(0);
  });
});
