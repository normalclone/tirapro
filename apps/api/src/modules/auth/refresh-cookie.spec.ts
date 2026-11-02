import { describe, expect, it } from 'vitest';

import { refreshCookieSecurity } from './refresh-cookie';

describe('refreshCookieSecurity', () => {
  it('production mặc định: Secure + SameSite=None (web và API khác domain)', () => {
    expect(refreshCookieSecurity(true, {})).toEqual({ secure: true, sameSite: 'none' });
  });
  it('dev: không Secure, SameSite=Lax', () => {
    expect(refreshCookieSecurity(false, {})).toEqual({ secure: false, sameSite: 'lax' });
  });
  it('COOKIE_SECURE=false trên production chạy HTTP: bỏ Secure để F5 không mất phiên', () => {
    expect(refreshCookieSecurity(true, { COOKIE_SECURE: 'false' })).toEqual({
      secure: false,
      sameSite: 'lax',
    });
  });
});
