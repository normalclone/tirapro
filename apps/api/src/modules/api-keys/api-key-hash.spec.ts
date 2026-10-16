import * as argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import { hashApiKeySecret, isLegacyArgon2Hash, verifyApiKeySecret } from './api-key-hash';

describe('api key hash', () => {
  const secret = 'a'.repeat(48);

  it('hash mới là sha256 hex 64 ký tự và verify đúng/sai', async () => {
    const h = hashApiKeySecret(secret);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(isLegacyArgon2Hash(h)).toBe(false);
    expect(await verifyApiKeySecret(h, secret)).toBe(true);
    expect(await verifyApiKeySecret(h, secret + 'x')).toBe(false);
  });

  it('hash lưu hỏng/khác độ dài → false, không throw', async () => {
    expect(await verifyApiKeySecret('abc', secret)).toBe(false);
    expect(await verifyApiKeySecret('', secret)).toBe(false);
  });

  it('key cũ (argon2) vẫn verify được', async () => {
    const legacy = await argon2.hash(secret);
    expect(isLegacyArgon2Hash(legacy)).toBe(true);
    expect(await verifyApiKeySecret(legacy, secret)).toBe(true);
    expect(await verifyApiKeySecret(legacy, 'b'.repeat(48))).toBe(false);
  });
});
