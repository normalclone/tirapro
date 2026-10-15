import { describe, expect, it } from 'vitest';
import { PASSWORD_POLICY_HINT, passwordPolicyError } from './passwordPolicy';

describe('passwordPolicyError', () => {
  it('mật khẩu yếu → thông điệp chính sách chung', () => {
    expect(passwordPolicyError('abc')).toBe(
      'Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số',
    );
    expect(passwordPolicyError('password1')).not.toBeNull(); // thiếu chữ hoa
    expect(passwordPolicyError('PASSWORD1')).not.toBeNull(); // thiếu chữ thường
    expect(passwordPolicyError('Passwordd')).not.toBeNull(); // thiếu số
  });

  it('mật khẩu hợp lệ → null', () => {
    expect(passwordPolicyError('Password1')).toBeNull();
  });

  it('bỏ trống (để hệ thống sinh mật khẩu tạm) → null', () => {
    expect(passwordPolicyError('')).toBeNull();
    expect(passwordPolicyError('   ')).toBeNull();
  });

  it('kiểm trên chuỗi đã trim (khớp chuỗi gửi lên server)', () => {
    expect(passwordPolicyError(' Password1 ')).toBeNull();
    expect(passwordPolicyError(' Pass1 ')).not.toBeNull(); // sau trim chỉ 5 ký tự
  });

  it('hint hiển thị khớp thông điệp lỗi', () => {
    expect(PASSWORD_POLICY_HINT).toContain('8 ký tự');
  });
});
