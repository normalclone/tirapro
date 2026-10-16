import { describe, expect, it } from 'vitest';
import { expectedProgress, periodRange } from './goal-pace';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('periodRange', () => {
  it('quý dạng YYYY-Qn → [ngày đầu, ngày cuối] UTC', () => {
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

describe('expectedProgress (mốc kỳ vọng theo thời gian của quý)', () => {
  it('đầu quý 0, cuối quý 100, tăng đơn điệu, kẹp ngoài kỳ', () => {
    expect(expectedProgress('2026-Q4', d('2026-10-01'))).toBe(0);
    expect(expectedProgress('2026-Q4', d('2026-12-31'))).toBe(100);
    expect(expectedProgress('2026-Q4', d('2026-09-01'))).toBe(0);
    expect(expectedProgress('2026-Q4', d('2027-02-01'))).toBe(100);
    const mid = expectedProgress('2026-Q4', d('2026-11-15'))!;
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(60);
  });

  it('kỳ tự do → null', () => {
    expect(expectedProgress('Sprint 5', d('2026-10-15'))).toBeNull();
  });
});
