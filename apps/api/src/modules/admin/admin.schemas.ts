import { z } from 'zod';

/** Zod cục bộ cho AdminModule (admin hệ thống quản trị tài khoản). */
export const createUserSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase(),
  displayName: z.string().min(1, 'Tên hiển thị bắt buộc').max(120),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự').max(200).optional(),
  isSystemAdmin: z.boolean().optional(),
  canCreateWorkspace: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  isSystemAdmin: z.boolean().optional(),
  canCreateWorkspace: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
