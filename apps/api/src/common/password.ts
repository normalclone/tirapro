import { randomBytes } from 'node:crypto';

/**
 * Mật khẩu tạm thoả `passwordSchema` (≥8 ký tự, có hoa/thường/số): 18 byte ngẫu nhiên (base64url, bỏ `-`/`_`)
 * + hậu tố đảm bảo đủ ba loại ký tự. Dùng cho mọi nơi sinh mật khẩu tạm (tạo tài khoản, đặt lại).
 */
export function generateTempPassword(): string {
  return `${randomBytes(18).toString('base64url').replace(/[-_]/g, 'x')}Aa1`;
}
