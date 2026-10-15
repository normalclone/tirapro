import { describe, expect, it } from 'vitest';
import { timeProgress } from './timeProgress';

describe('timeProgress', () => {
  it('có ước lượng: phần trăm làm tròn, chặn 100, over khi vượt', () => {
    expect(timeProgress(0, 8 * 3600)).toEqual({ pct: 0, over: false });
    expect(timeProgress(4 * 3600, 8 * 3600)).toEqual({ pct: 50, over: false });
    expect(timeProgress(8 * 3600, 8 * 3600)).toEqual({ pct: 100, over: false });
    expect(timeProgress(12 * 3600, 8 * 3600)).toEqual({ pct: 100, over: true });
  });
  it('chưa có ước lượng gốc (null/0/undefined): pct = null dù đã ghi giờ — KHÔNG phải 100%', () => {
    expect(timeProgress(3600, null)).toEqual({ pct: null, over: false });
    expect(timeProgress(3600, 0)).toEqual({ pct: null, over: false });
    expect(timeProgress(0, undefined)).toEqual({ pct: null, over: false });
  });
});
