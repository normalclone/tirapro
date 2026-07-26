import { z } from 'zod';

/** Chuỗi ngày ISO (chấp nhận cả 'YYYY-MM-DD' lẫn ISO đầy đủ). */
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Ngày không hợp lệ');

export const dependencyTypeSchema = z.enum(['FS', 'SS', 'FF', 'SF']);

export const createDependencySchema = z.object({
  predecessorId: z.string().min(1, 'Thiếu công việc trước'),
  successorId: z.string().min(1, 'Thiếu công việc sau'),
  type: dependencyTypeSchema.optional().default('FS'),
  /** Độ trễ (ngày) — âm = cho phép chồng lấn. */
  lagDays: z.number().int().min(-365).max(365).optional().default(0),
});

export const createMilestoneSchema = z.object({
  name: z.string().min(1, 'Tên cột mốc bắt buộc').max(120),
  dueDate: isoDate,
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  completedAt: isoDate.nullable().optional(),
});

export const updateMilestoneSchema = createMilestoneSchema.partial();

export const createBaselineSchema = z.object({
  name: z.string().min(1, 'Tên kế hoạch gốc bắt buộc').max(120),
});

export type DependencyTypeInput = z.infer<typeof dependencyTypeSchema>;
export type CreateDependencyInput = z.infer<typeof createDependencySchema>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;
export type CreateBaselineInput = z.infer<typeof createBaselineSchema>;
