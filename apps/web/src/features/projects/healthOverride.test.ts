import { describe, expect, it } from 'vitest';
import { canSubmit } from './healthOverride';

describe('canSubmit', () => {
  it('đặt mức cần ghi chú ≥1 ký tự; bỏ ghi đè không cần', () => {
    expect(canSubmit('RED', '')).toBe(false);
    expect(canSubmit('RED', '   ')).toBe(false);
    expect(canSubmit('RED', 'Chờ khách duyệt')).toBe(true);
    expect(canSubmit(null, '')).toBe(true);
  });
  it('ghi chú dài hơn 500 ký tự bị chặn (khớp API)', () => {
    expect(canSubmit('YELLOW', 'a'.repeat(500))).toBe(true);
    expect(canSubmit('YELLOW', 'a'.repeat(501))).toBe(false);
  });
});
