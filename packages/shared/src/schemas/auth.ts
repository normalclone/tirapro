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

/** Cập nhật hồ sơ cá nhân (PATCH /users/me) — khoá lạ bị loại bỏ, không ghi thẳng vào DB. */
export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1, 'Tên hiển thị không được để trống').max(100, 'Tên hiển thị tối đa 100 ký tự').optional(),
  avatarUrl: z.string().trim().max(2048, 'Đường dẫn ảnh quá dài').nullable().optional(),
  timezone: z.string().trim().min(1).max(64, 'Múi giờ không hợp lệ').optional(),
  locale: z.string().trim().min(2).max(16, 'Ngôn ngữ không hợp lệ').optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
