import { z } from 'zod';
import { passwordSchema } from '@tirapro/shared';

export const setRolesSchema = z.object({
  roleIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 vai trò').max(20),
});

export const addProjectMemberSchema = z.object({
  userId: z.string().min(1),
  roleIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 vai trò').max(20),
});

/** Thêm NHIỀU người một lúc (workspace hoặc project) với cùng bộ vai trò. */
export const addMembersBulkSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1, 'Chọn ít nhất 1 người').max(200),
  roleIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 vai trò').max(20),
});

/**
 * Tạo tài khoản mới + thêm vào workspace trong một lần. `password` bỏ trống → hệ thống sinh mật khẩu tạm
 * (trả về MỘT lần). Chính sách mật khẩu dùng chung `passwordSchema`.
 */
export const createMemberAccountSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase(),
  displayName: z.string().trim().min(1, 'Tên hiển thị bắt buộc').max(120),
  roleIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 vai trò').max(20),
  password: passwordSchema.optional(),
});

export type SetRolesInput = z.infer<typeof setRolesSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type AddMembersBulkInput = z.infer<typeof addMembersBulkSchema>;
export type CreateMemberAccountInput = z.infer<typeof createMemberAccountSchema>;
