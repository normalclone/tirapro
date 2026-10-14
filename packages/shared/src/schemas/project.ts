import { z } from 'zod';

/** Sửa dự án. Mã dự án (key) cố định vì đã nằm trong mã mọi công việc; ảnh đại diện có route riêng. */
export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên dự án không được để trống').max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    leadId: z.string().min(1).nullable().optional(),
    defaultAssigneeMode: z.enum(['UNASSIGNED', 'PROJECT_LEAD']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Hãy chọn ít nhất một thay đổi');

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
