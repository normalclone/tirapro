import { z } from 'zod';
import { passwordSchema } from '@tirapro/shared';

/** Zod cục bộ cho AdminModule (admin hệ thống quản trị tài khoản). */
export const createUserSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase(),
  displayName: z.string().min(1, 'Tên hiển thị bắt buộc').max(120),
  password: passwordSchema.optional(),
  isSystemAdmin: z.boolean().optional(),
  canCreateOrganization: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  /** Đổi email đăng nhập (vd chuyển sang email công ty). Phải chưa thuộc tài khoản khác. */
  email: z.string().trim().email('Email không hợp lệ').toLowerCase().optional(),
  displayName: z.string().min(1).max(120).optional(),
  isSystemAdmin: z.boolean().optional(),
  canCreateOrganization: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
});

/** Admin hệ thống thêm một tài khoản vào một tổ chức (vai trò mặc định: Organization Member). */
export const addToOrganizationSchema = z.object({
  organizationId: z.string().min(1),
  roleIds: z.array(z.string().min(1)).max(20).optional(),
});

export const listUsersQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
});

export type AddToOrganizationInput = z.infer<typeof addToOrganizationSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
