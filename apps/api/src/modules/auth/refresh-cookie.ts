import type { Response } from 'express';

export const REFRESH_COOKIE = 'tirapro_rt';

const REFRESH_COOKIE_DAYS = 7;

/**
 * `COOKIE_SECURE=false`: máy chủ nội bộ chạy HTTP thường (vd http://172.20.20.128:8088, web + API cùng origin qua
 * nginx). Cookie `Secure` trên trang HTTP bị trình duyệt bỏ → F5 là mất phiên. Khi đó dùng Secure=false + SameSite=Lax
 * (cùng origin nên Lax đủ). Không đặt biến = giữ hành vi cũ theo `isProd`.
 */
export function refreshCookieSecurity(
  isProd: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { secure: boolean; sameSite: 'none' | 'lax' } {
  const secure = env.COOKIE_SECURE === 'false' ? false : isProd;
  return { secure, sameSite: secure ? 'none' : 'lax' };
}

/**
 * Production: web và API thường KHÁC domain (vd *.onrender.com) → cookie phải SameSite=None + Secure thì trình duyệt
 * mới gửi kèm khi gọi chéo site; để 'lax' thì /auth/refresh luôn 401 → reload là bị đăng xuất.
 */
export function setRefreshCookie(res: Response, token: string, isProd: boolean): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    ...refreshCookieSecurity(isProd),
    path: '/',
    maxAge: REFRESH_COOKIE_DAYS * 24 * 60 * 60 * 1000,
  });
}

/** Xoá cookie phải khớp thuộc tính lúc set (secure/sameSite) thì trình duyệt mới chấp nhận. */
export function clearRefreshCookie(res: Response, isProd: boolean): void {
  res.clearCookie(REFRESH_COOKIE, {
    path: '/',
    ...refreshCookieSecurity(isProd),
    httpOnly: true,
  });
}
