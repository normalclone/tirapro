import { z } from 'zod';

/** Zod cục bộ cho RolesModule (catalog + CRUD custom role). */
export const createRoleSchema = z.object({
  name: z.string().min(1, 'Tên vai trò bắt buộc').max(60),
  scope: z.enum(['ORGANIZATION', 'PROJECT']),
  description: z.string().max(200).optional(),
  color: z.string().max(40).optional(),
  permissionKeys: z.array(z.string()).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(200).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  permissionKeys: z.array(z.string()).optional(),
  /**
   * Điều kiện tiên quyết lạc quan: `updatedAt` của vai trò mà client đã thấy. Lệch (người khác vừa sửa) → 409
   * VERSION_CONFLICT. Bỏ trống = không kiểm (client cũ).
   */
  expectedUpdatedAt: z.string().datetime().optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** Tạo vai trò riêng của dự án: "từ mẫu" (`fromTemplateId`, tên mặc định = tên mẫu) hoặc tự chọn quyền (cần `name`). */
export const createProjectRoleSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên vai trò bắt buộc').max(60).optional(),
    fromTemplateId: z.string().min(1).optional(),
    description: z.string().max(200).optional(),
    color: z.string().max(40).optional(),
    permissionKeys: z.array(z.string()).optional(),
  })
  .refine((v) => !!v.name || !!v.fromTemplateId, { message: 'Nhập tên vai trò hoặc chọn một mẫu' });

export const updateProjectRoleSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(200).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  permissionKeys: z.array(z.string()).optional(),
});

export type CreateProjectRoleInput = z.infer<typeof createProjectRoleSchema>;
export type UpdateProjectRoleInput = z.infer<typeof updateProjectRoleSchema>;
