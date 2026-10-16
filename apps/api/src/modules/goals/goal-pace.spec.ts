import { describe, expect, it } from 'vitest';
import { expectedProgress, isBehind } from './goal-pace';

describe('expectedProgress', () => {
  it('đầu quý ~0%, giữa quý ~50%, cuối quý 100%', () => {
    expect(expectedProgress('2026-Q4', new Date('2026-10-01T00:00:00Z'))).toBeCloseTo(0, 0);
    expect(expectedProgress('2026-Q4', new Date('2026-11-16T12:00:00Z'))).toBeGreaterThan(48);
    expect(expectedProgress('2026-Q4', new Date('2026-11-16T12:00:00Z'))).toBeLessThan(53);
    expect(expectedProgress('2026-Q4', new Date('2026-12-31T23:00:00Z'))).toBe(100);
  });

  it('kỳ tự do → null; kỳ chưa tới → 0; kỳ đã qua → 100', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    expect(expectedProgress('FY26', now)).toBeNull();
    expect(expectedProgress('2026-Q5', now)).toBeNull();
    expect(expectedProgress('Q4 2026', now)).toBeNull();
    expect(expectedProgress('2027-Q1', now)).toBe(0);
    expect(expectedProgress('2026-Q3', now)).toBe(100);
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
