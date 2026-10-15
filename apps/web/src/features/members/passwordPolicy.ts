import { passwordSchema } from '@tirapro/shared';

/** Thông điệp chính sách mật khẩu dùng chung (đăng ký = admin tạo = đặt lại). */
export const PASSWORD_POLICY_MESSAGE = 'Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số';

/** Gợi ý dưới ô mật khẩu khi tạo tài khoản. */
export const PASSWORD_POLICY_HINT =
  'Bỏ trống để hệ thống sinh mật khẩu tạm. Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số';

/** Lỗi chính sách mật khẩu phía client; chuỗi rỗng (hoặc chỉ khoảng trắng) = để hệ thống sinh → không lỗi. */
export function passwordPolicyError(password: string): string | null {
  if (!password.trim()) return null;
  return passwordSchema.safeParse(password).success ? null : PASSWORD_POLICY_MESSAGE;
}
