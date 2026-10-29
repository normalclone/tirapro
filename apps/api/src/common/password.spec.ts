import { describe, expect, it } from 'vitest';
import { passwordSchema } from '@tirapro/shared';
import { generateTempPassword } from './password';

describe('generateTempPassword', () => {
  it('luôn thoả passwordSchema (8+ ký tự, hoa/thường/số) và không trùng nhau', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const p = generateTempPassword();
      expect(passwordSchema.safeParse(p).success, p).toBe(true);
      seen.add(p);
    }
    expect(seen.size).toBe(300);
  });
});
