import { describe, expect, it } from 'vitest';
import { completionPct, fmtPoints } from './sprintSummary';

describe('completionPct', () => {
  it('kẹp 0..100 và an toàn khi committed = 0', () => {
    expect(completionPct(18, 24)).toBe(75);
    expect(completionPct(0, 0)).toBe(0);
    expect(completionPct(30, 24)).toBe(100);
    expect(completionPct(-3, 24)).toBe(0);
  });

  it('làm tròn tới số nguyên gần nhất', () => {
    expect(completionPct(1, 3)).toBe(33);
    expect(completionPct(2, 3)).toBe(67);
  });
});

describe('fmtPoints', () => {
  it('số nguyên giữ nguyên, số lẻ lấy tối đa 1 chữ số thập phân', () => {
    expect(fmtPoints(18)).toBe('18');
    expect(fmtPoints(2.5)).toBe('2,5');
    expect(fmtPoints(2.25)).toBe('2,3');
    expect(fmtPoints(0)).toBe('0');
  });
});
