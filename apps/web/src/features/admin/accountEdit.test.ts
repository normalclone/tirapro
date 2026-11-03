import { describe, expect, it } from 'vitest';
import { buildAccountPatch, validateAccountEdit } from './accountEdit';

const user = { displayName: 'An', email: 'an@x.com' };

describe('Sửa tài khoản (logbug #31)', () => {
  it('kiểm tên và email', () => {
    expect(validateAccountEdit({ displayName: ' ', email: 'a@b.co' }).displayName).not.toBe('');
    expect(validateAccountEdit({ displayName: 'A', email: 'sai' }).email).toContain(
      'ten@congty.com',
    );
    expect(validateAccountEdit({ displayName: 'A', email: 'a@b.co' })).toEqual({
      displayName: '',
      email: '',
    });
  });
  it('chỉ gửi trường đổi; không đổi → null', () => {
    expect(buildAccountPatch(user, { displayName: ' An ', email: 'AN@x.com' })).toBeNull();
    expect(buildAccountPatch(user, { displayName: 'Bình', email: 'an@x.com' })).toEqual({
      displayName: 'Bình',
    });
    expect(buildAccountPatch(user, { displayName: 'An', email: ' New@X.com ' })).toEqual({
      email: 'new@x.com',
    });
  });
});
