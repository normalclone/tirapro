import { z } from 'zod';

/** Sửa dự án. Mã dự án (key) cố định vì đã nằm trong mã mọi công việc; ảnh đại diện có route riêng. */
export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên dự án không được để trống').max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    leadId: z.string().min(1).nullable().optional(),
    defaultAssigneeMode: z.enum(['UNASSIGNED', 'PROJECT_LEAD']).optional(),
    /** Bật/tắt dự án riêng tư (chỉ quản trị dự án). */
    isPrivate: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Hãy chọn ít nhất một thay đổi');

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/**
 * Đặt/bỏ sức khoẻ dự án thủ công. `health: null` = bỏ ghi đè (về giá trị tự tính, xoá cả ghi chú).
 * Khi đặt thì bắt buộc có `note` (1–500 ký tự) — người đọc cần biết vì sao PM khác với số liệu tự tính;
 * service kiểm riêng để trả thông điệp tiếng Việt rõ ràng.
 */
export const setProjectHealthSchema = z.object({
  health: z.enum(['GREEN', 'YELLOW', 'RED']).nullable(),
  note: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional(),
});

export type SetProjectHealthInput = z.infer<typeof setProjectHealthSchema>;
