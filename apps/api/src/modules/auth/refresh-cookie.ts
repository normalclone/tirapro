import type { Response } from 'express';

export const REFRESH_COOKIE = 'tirapro_rt';

const REFRESH_COOKIE_DAYS = 7;

/**
 * Production: web và API thường KHÁC domain (vd *.onrender.com) → cookie phải SameSite=None + Secure thì trình duyệt
 * mới gửi kèm khi gọi chéo site; để 'lax' thì /auth/refresh luôn 401 → reload là bị đăng xuất.
 */
export function setRefreshCookie(res: Response, token: string, isProd: boolean): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: REFRESH_COOKIE_DAYS * 24 * 60 * 60 * 1000,
  });
}

/** Xoá cookie phải khớp thuộc tính lúc set (secure/sameSite) thì trình duyệt mới chấp nhận. */
export function clearRefreshCookie(res: Response, isProd: boolean): void {
  res.clearCookie(REFRESH_COOKIE, {
    path: '/',
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    httpOnly: true,
  });
}
