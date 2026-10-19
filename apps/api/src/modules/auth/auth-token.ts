import { createHash, randomBytes } from 'node:crypto';

/** Token một-lần gửi qua email: 32 byte ngẫu nhiên, base64url. Chỉ gửi bản thô; DB chỉ giữ sha256. */
export function generateOneTimeToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashOneTimeToken(token) };
}

export function hashOneTimeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
