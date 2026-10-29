import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGithubSignature, verifyGitlabToken } from './webhook-signature';

const secret = 'whsec_test_secret';
const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main', commits: [] }));
const sign = (raw: Buffer, key: string) =>
  'sha256=' + createHmac('sha256', key).update(raw).digest('hex');

describe('verifyGithubSignature', () => {
  it('đúng với HMAC-SHA256 sha256=<hex>', () => {
    expect(verifyGithubSignature(body, secret, sign(body, secret))).toBe(true);
  });

  it('sai secret → false', () => {
    expect(verifyGithubSignature(body, secret, sign(body, 'khac'))).toBe(false);
  });

  it('body bị sửa → false', () => {
    expect(verifyGithubSignature(Buffer.from('{"x":1}'), secret, sign(body, secret))).toBe(false);
  });

  it('thiếu header / rỗng → false', () => {
    expect(verifyGithubSignature(body, secret, undefined)).toBe(false);
    expect(verifyGithubSignature(body, secret, '')).toBe(false);
  });

  it('độ dài khác → false, không throw', () => {
    expect(() => verifyGithubSignature(body, secret, 'sha256=abc')).not.toThrow();
    expect(verifyGithubSignature(body, secret, 'sha256=abc')).toBe(false);
    expect(verifyGithubSignature(body, secret, 'sha256=' + 'a'.repeat(200))).toBe(false);
  });

  it('thiếu rawBody → false', () => {
    expect(verifyGithubSignature(undefined, secret, sign(body, secret))).toBe(false);
  });
});

describe('verifyGitlabToken', () => {
  it('token trùng → true', () => {
    expect(verifyGitlabToken(secret, secret)).toBe(true);
  });

  it('token sai hoặc khác độ dài → false, không throw', () => {
    expect(verifyGitlabToken(secret, 'sai-token-xx-xxxx')).toBe(false);
    expect(() => verifyGitlabToken(secret, 'ngan')).not.toThrow();
    expect(verifyGitlabToken(secret, 'ngan')).toBe(false);
    expect(verifyGitlabToken(secret, undefined)).toBe(false);
  });
});
