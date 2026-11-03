import { describe, expect, it } from 'vitest';
import { currentOverTarget, CURRENT_OVER_TARGET_MESSAGE } from './goal-values';

describe('currentOverTarget (logbug #30)', () => {
  it('KR tăng dần: hiện tại > đích là sai', () => {
    expect(currentOverTarget(0, 100, 130)).toBe(true);
    expect(currentOverTarget(0, 100, 100)).toBe(false);
    expect(currentOverTarget(undefined, 100, 101)).toBe(true);
  });
  it('KR giảm dần (xuất phát > đích): không báo', () => {
    expect(currentOverTarget(50, 10, 30)).toBe(false);
    expect(currentOverTarget(50, 10, 5)).toBe(false);
  });
  it('thông báo đúng văn bản đã chốt', () => {
    expect(CURRENT_OVER_TARGET_MESSAGE).toBe(
      'Giá trị Hiện tại không được lớn hơn giá trị Cần đạt.',
    );
  });
});
