import { createHmac, timingSafeEqual } from 'node:crypto';

/** So sánh hai chuỗi theo thời gian hằng; khác độ dài → false (không throw). */
function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * GitHub: header `X-Hub-Signature-256` = `sha256=<hex HMAC-SHA256 của raw body>`.
 * Phải tính trên body gốc (rawBody), không phải JSON đã parse lại.
 */
export function verifyGithubSignature(
  rawBody: Buffer | undefined,
  secret: string,
  header: string | undefined,
): boolean {
  if (!rawBody || !secret || !header) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(Buffer.from(expected, 'utf8'), Buffer.from(header, 'utf8'));
}

/** GitLab: header `X-Gitlab-Token` chứa đúng secret đã cấu hình. */
export function verifyGitlabToken(secret: string, token: string | undefined): boolean {
  if (!secret || !token) return false;
  return safeEqual(Buffer.from(secret, 'utf8'), Buffer.from(token, 'utf8'));
}
