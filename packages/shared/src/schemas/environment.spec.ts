import { describe, expect, it } from 'vitest';
import { environmentSchema, formatEnvironment, normalizeEnvironment } from './environment';

describe('environment', () => {
  it('normalize bỏ khoá rỗng, null khi trống', () => {
    expect(normalizeEnvironment({ env: 'staging', browser: '  Chrome 126 ', os: '' })).toEqual({
      env: 'staging',
      browser: 'Chrome 126',
    });
    expect(normalizeEnvironment({ browser: ' ', os: '' })).toBeNull();
  });
  it('schema từ chối url không phải http(s) và khoá lạ', () => {
    expect(environmentSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(environmentSchema.safeParse({ foo: 'x' }).success).toBe(false);
    expect(environmentSchema.safeParse({ url: 'https://app.example.com/cart' }).success).toBe(true);
  });
  it('formatEnvironment: một dòng, bỏ phần trống', () => {
    expect(
      formatEnvironment({
        env: 'production',
        browser: 'Chrome 126',
        os: 'macOS 14',
        build: '2.3.1',
        viewport: '1440×900',
        url: 'https://a.vn/x',
      }),
    ).toBe('production · Chrome 126 · macOS 14 · build 2.3.1 · 1440×900 · https://a.vn/x');
    expect(formatEnvironment({ os: 'iOS 17.5' })).toBe('iOS 17.5');
    expect(formatEnvironment(null)).toBe('');
  });
});
