import { passwordSchema } from '@tirapro/shared';

/** Thông điệp chính sách mật khẩu dùng chung (đăng ký = admin tạo = đặt lại). */
const PASSWORD_POLICY_MESSAGE = 'Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số';

/** Gợi ý dưới ô mật khẩu khi tạo tài khoản. */
export const PASSWORD_POLICY_HINT =
  'Bỏ trống để hệ thống sinh mật khẩu tạm. Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số';

/**
 * Lỗi chính sách mật khẩu phía client. Kiểm trên chuỗi ĐÃ TRIM — đúng chuỗi sẽ gửi lên server
 * (form cắt khoảng trắng hai đầu); chuỗi rỗng = để hệ thống sinh → không lỗi.
 */
export function passwordPolicyError(password: string): string | null {
  const value = password.trim();
  if (!value) return null;
  return passwordSchema.safeParse(value).success ? null : PASSWORD_POLICY_MESSAGE;
}
