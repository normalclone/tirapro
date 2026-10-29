import { describe, expect, it } from 'vitest';
import { displayRemaining, timeProgress } from './timeProgress';

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

describe('displayRemaining — "Còn lại" không còn "—" khi đã có ước lượng gốc', () => {
  const h = 3600;
  it('có ước lượng còn lại đã lưu: dùng nguyên, không đánh dấu ước tính', () => {
    expect(displayRemaining(2 * h, 8 * h, 5 * h)).toEqual({ seconds: 5 * h, estimated: false });
    expect(displayRemaining(2 * h, 8 * h, 0)).toEqual({ seconds: 0, estimated: false });
  });
  it('có gốc, chưa có còn lại: max(0, gốc − đã ghi), đánh dấu ước tính', () => {
    expect(displayRemaining(2 * h, 8 * h, null)).toEqual({ seconds: 6 * h, estimated: true });
    expect(displayRemaining(0, 8 * h, undefined)).toEqual({ seconds: 8 * h, estimated: true });
  });
  it('đã ghi vượt gốc: không âm', () => {
    expect(displayRemaining(12 * h, 8 * h, null)).toEqual({ seconds: 0, estimated: true });
  });
  it('chưa có ước lượng gốc (null/0) và chưa có còn lại: seconds = null (hiện "—")', () => {
    expect(displayRemaining(h, null, null)).toEqual({ seconds: null, estimated: false });
    expect(displayRemaining(h, 0, null)).toEqual({ seconds: null, estimated: false });
  });
});
