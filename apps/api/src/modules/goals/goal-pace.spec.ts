import { describe, expect, it } from 'vitest';
import { expectedProgress, isBehind, periodRange } from './goal-pace';

describe('periodRange', () => {
  it('quý dạng YYYY-Qn → [ngày đầu, ngày cuối] UTC; chấp nhận khoảng trắng và q thường', () => {
    expect(periodRange('2026-Q4')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(periodRange('2026-Q1')).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(periodRange(' 2026-q2 ')).toEqual({ start: '2026-04-01', end: '2026-06-30' });
  });

  it('kỳ tự do hoặc quý không hợp lệ → null', () => {
    expect(periodRange('H2 2026')).toBeNull();
    expect(periodRange('2026-Q5')).toBeNull();
    expect(periodRange('2026')).toBeNull();
  });
});

describe('expectedProgress — ngày lịch VN (Q-M7)', () => {
  it('18:00Z ngày 15/11 là 01:00 ngày 16/11 giờ VN → tính theo 16/11 (51%), không phải 15/11 (49%)', () => {
    expect(expectedProgress('2026-Q4', new Date('2026-11-15T18:00:00Z'))).toBe(51);
    expect(expectedProgress('2026-Q4', new Date('2026-11-15T16:00:00Z'))).toBe(49); // 23:00 VN 15/11
  });
});

describe('expectedProgress', () => {
  it('đầu quý 0, giữa quý ~50%, cuối quý 100', () => {
    expect(expectedProgress('2026-Q4', new Date('2026-10-01T00:00:00Z'))).toBe(0);
    expect(expectedProgress('2026-Q4', new Date('2026-11-16T12:00:00Z'))).toBeGreaterThan(48);
    expect(expectedProgress('2026-Q4', new Date('2026-11-16T12:00:00Z'))).toBeLessThan(53);
    expect(expectedProgress('2026-Q4', new Date('2026-12-31T23:00:00Z'))).toBe(100);
  });

  it('tăng đơn điệu theo ngày; làm tròn số nguyên', () => {
    let prev = -1;
    for (let d = 0; d < 92; d++) {
      const v = expectedProgress('2026-Q4', new Date(Date.UTC(2026, 9, 1 + d)))!;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('kỳ tự do → null; kỳ chưa tới → 0; kỳ đã qua → 100; regex không phân biệt hoa thường', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    expect(expectedProgress('FY26', now)).toBeNull();
    expect(expectedProgress('2026-Q5', now)).toBeNull();
    expect(expectedProgress('Q4 2026', now)).toBeNull();
    expect(expectedProgress('2027-Q1', now)).toBe(0);
    expect(expectedProgress('2026-Q3', now)).toBe(100);
    expect(expectedProgress(' 2026-q4 ', now)).toBe(expectedProgress('2026-Q4', now));
  });
});

describe('isBehind', () => {
  it('chậm từ 15 điểm phần trăm trở lên so với thời gian đã trôi', () => {
    expect(isBehind(35, 50)).toBe(true);
    expect(isBehind(36, 50)).toBe(false);
    expect(isBehind(80, 50)).toBe(false);
  });
  it('0% ngay đầu quý không bị coi là chậm', () => {
    expect(isBehind(0, expectedProgress('2026-Q4', new Date('2026-10-05T00:00:00Z'))!)).toBe(false);
  });
});
