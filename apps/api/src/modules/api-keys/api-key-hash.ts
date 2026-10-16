import * as argon2 from 'argon2';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Secret của API key là 24 byte ngẫu nhiên (192 bit) nên không cần hash chậm như mật khẩu:
 * sha256 hex là đủ và xác thực mỗi request chỉ tốn micro-giây (argon2 ~50–100ms).
 */
export function hashApiKeySecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Hash cũ (key tạo trước khi đổi sang sha256) có dạng `$argon2...`. */
export function isLegacyArgon2Hash(stored: string): boolean {
  return stored.startsWith('$argon2');
}

/** Kiểm secret với hash đã lưu: argon2 cho key cũ, sha256 (so sánh thời gian hằng) cho key mới. */
export async function verifyApiKeySecret(stored: string, secret: string): Promise<boolean> {
  if (isLegacyArgon2Hash(stored)) {
    return argon2.verify(stored, secret).catch(() => false);
  }
  const expected = Buffer.from(stored, 'utf8');
  const actual = Buffer.from(hashApiKeySecret(secret), 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
