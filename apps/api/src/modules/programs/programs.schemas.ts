import { z } from 'zod';

/**
 * Ngày nhận cả 'YYYY-MM-DD' (input type=date của FE) lẫn ISO-8601 đầy đủ.
 * Chuỗi rỗng = bỏ trống (service tự quy về null) để FE không phải chuyển '' → null.
 */
export const dateInput = z
  .string()
  .trim()
  .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Ngày không hợp lệ')
  .nullable()
  .optional();

export const createProgramSchema = z.object({
  name: z.string().trim().min(1, 'Tên chương trình bắt buộc').max(120),
  description: z.string().max(1000).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  startDate: dateInput,
  targetDate: dateInput,
  /** Gán sẵn dự án ngay khi tạo (tuỳ chọn). */
  projectIds: z.array(z.string().min(1)).max(500).optional(),
});

export const updateProgramSchema = createProgramSchema.partial();

export const setProgramProjectsSchema = z.object({
  projectIds: z.array(z.string().min(1)).max(500),
});

export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;
export type SetProgramProjectsInput = z.infer<typeof setProgramProjectsSchema>;
