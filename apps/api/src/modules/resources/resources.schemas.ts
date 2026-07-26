import { z } from 'zod';

/** Ngày dạng `YYYY-MM-DD` hoặc ISO đầy đủ. */
const dayString = z
  .string()
  .trim()
  .min(8, 'Ngày không hợp lệ')
  .refine((v) => !Number.isNaN(Date.parse(v.length === 10 ? `${v}T00:00:00.000Z` : v)), 'Ngày không hợp lệ');

const optionalDay = dayString.optional();

/* ───────────────────────── Phân bổ (Allocation) ───────────────────────── */

export const createAllocationSchema = z.object({
  projectId: z.string().min(1, 'Chọn dự án'),
  userId: z.string().min(1, 'Chọn thành viên'),
  percent: z.number().int('Tỉ lệ phải là số nguyên').min(1, 'Tỉ lệ tối thiểu 1%').max(200, 'Tỉ lệ tối đa 200%').default(100),
  startDate: dayString,
  endDate: dayString,
  note: z.string().max(500).optional().nullable(),
});

export const updateAllocationSchema = createAllocationSchema.partial();

export const listAllocationsQuerySchema = z.object({
  projectId: z.string().optional(),
  userId: z.string().optional(),
  from: optionalDay,
  to: optionalDay,
});

/* ───────────────────────── Nghỉ phép / ngày lễ ───────────────────────── */

export const TIME_OFF_KINDS = ['LEAVE', 'HOLIDAY', 'OTHER'] as const;

export const createTimeOffSchema = z.object({
  /** Bỏ trống / null = ngày lễ áp dụng cho TOÀN workspace. */
  userId: z.string().min(1).optional().nullable(),
  kind: z.enum(TIME_OFF_KINDS).default('LEAVE'),
  startDate: dayString,
  endDate: dayString,
  note: z.string().max(500).optional().nullable(),
});

export const updateTimeOffSchema = createTimeOffSchema.partial();

export const listTimeOffQuerySchema = z.object({
  userId: z.string().optional(),
  kind: z.enum(TIME_OFF_KINDS).optional(),
  from: optionalDay,
  to: optionalDay,
});

/* ───────────────────────── Tải theo tuần ───────────────────────── */

export const workloadQuerySchema = z.object({
  from: optionalDay,
  to: optionalDay,
  projectId: z.string().optional(),
});

export type CreateAllocationInput = z.infer<typeof createAllocationSchema>;
export type UpdateAllocationInput = z.infer<typeof updateAllocationSchema>;
export type ListAllocationsQuery = z.infer<typeof listAllocationsQuerySchema>;
export type CreateTimeOffInput = z.infer<typeof createTimeOffSchema>;
export type UpdateTimeOffInput = z.infer<typeof updateTimeOffSchema>;
export type ListTimeOffQuery = z.infer<typeof listTimeOffQuerySchema>;
export type WorkloadQuery = z.infer<typeof workloadQuerySchema>;
