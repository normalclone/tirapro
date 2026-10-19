import { describe, expect, it } from 'vitest';
import { isSessionRevoked } from './session-revocation';

describe('isSessionRevoked', () => {
  const revoked = new Date(2_000_500);
  it('chưa có mốc thu hồi -> không bị thu hồi', () => {
    expect(isSessionRevoked({ iat: 1 }, null)).toBe(false);
    expect(isSessionRevoked({}, undefined)).toBe(false);
  });
  it('iatMs chính xác tới ms: trước mốc -> thu hồi, sau mốc -> hợp lệ', () => {
    expect(isSessionRevoked({ iat: 2000, iatMs: 2_000_400 }, revoked)).toBe(true);
    expect(isSessionRevoked({ iat: 2000, iatMs: 2_000_600 }, revoked)).toBe(false);
  });
  it('token cũ chỉ có iat: coi như cấp cuối giây đó (cùng giây với mốc vẫn hợp lệ)', () => {
    expect(isSessionRevoked({ iat: 1000 }, revoked)).toBe(true);
    expect(isSessionRevoked({ iat: 2000 }, revoked)).toBe(false);
    expect(isSessionRevoked({ iat: 2001 }, revoked)).toBe(false);
  });
  it('thiếu cả iat lẫn iatMs -> thu hồi (fail-closed)', () => {
    expect(isSessionRevoked({}, revoked)).toBe(true);
  });
});
