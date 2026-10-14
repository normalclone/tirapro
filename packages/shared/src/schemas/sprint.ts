import { z } from 'zod';

/** Sửa sprint. Sprint đang chạy chỉ cho đổi mục tiêu + ngày kết thúc (service kiểm theo trạng thái). */
export const updateSprintSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên sprint không được để trống').max(120).optional(),
    goal: z.string().max(1000).nullable().optional(),
    startDate: z.string().datetime().nullable().optional(),
    endDate: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Hãy chọn ít nhất một thay đổi');

/**
 * Hoàn thành sprint: việc chưa Done đi đâu — về backlog, sang sprint mới (tự tạo, FUTURE) hoặc một sprint FUTURE có sẵn.
 * Thiếu body (client cũ) = về backlog như trước.
 */
export const completeSprintSchema = z.object({
  moveIncompleteTo: z
    .union([z.literal('backlog'), z.literal('new'), z.object({ sprintId: z.string().min(1) })])
    .default('backlog'),
});

export type UpdateSprintInput = z.infer<typeof updateSprintSchema>;
export type CompleteSprintInput = z.infer<typeof completeSprintSchema>;
