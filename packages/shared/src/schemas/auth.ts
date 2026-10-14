import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .max(128)
  .regex(/[a-z]/, 'Cần ít nhất 1 chữ thường')
  .regex(/[A-Z]/, 'Cần ít nhất 1 chữ hoa')
  .regex(/[0-9]/, 'Cần ít nhất 1 chữ số');

export const registerSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase(),
  password: passwordSchema,
  displayName: z.string().min(1, 'Tên hiển thị bắt buộc').max(120),
  workspaceName: z.string().min(1).max(120).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1, 'Mật khẩu bắt buộc'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mật khẩu hiện tại bắt buộc'),
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20, 'Liên kết không hợp lệ').max(200),
  newPassword: passwordSchema,
});

export const createInviteSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase(),
  /** Vai trò workspace cho người được mời; bỏ trống → "Workspace Member". */
  roleId: z.string().min(1).optional(),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(20, 'Liên kết không hợp lệ').max(200),
  displayName: z.string().trim().min(1, 'Tên hiển thị bắt buộc').max(120),
  password: passwordSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
