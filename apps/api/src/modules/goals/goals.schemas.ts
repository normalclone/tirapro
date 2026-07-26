import { z } from 'zod';

export const objectiveStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'CLOSED']);
export const keyResultUnitEnum = z.enum(['NUMBER', 'PERCENT', 'CURRENCY']);

/**
 * Kết quả then chốt (Key Result) trong payload mục tiêu.
 * Có `id` → cập nhật KR đó; không có `id` → tạo mới. KR cũ không xuất hiện trong
 * mảng gửi lên sẽ bị xoá (semantics "thay cả danh sách nhưng giữ id").
 */
export const keyResultUpsertSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, 'Tên kết quả then chốt bắt buộc').max(160),
  unit: keyResultUnitEnum.optional(),
  startValue: z.number().finite().optional(),
  targetValue: z.number().finite(),
  currentValue: z.number().finite().optional(),
});

export const createGoalSchema = z.object({
  name: z.string().trim().min(1, 'Tên mục tiêu bắt buộc').max(160),
  description: z.string().max(2000).optional().nullable(),
  period: z.string().trim().min(1, 'Kỳ bắt buộc').max(30),
  status: objectiveStatusEnum.optional(),
  projectId: z.string().min(1).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  keyResults: z.array(keyResultUpsertSchema).max(30).optional(),
  issueIds: z.array(z.string().min(1)).max(200).optional(),
});

export const updateGoalSchema = createGoalSchema.partial();

/** Tạo KR lồng: POST /goals/:id/key-results */
export const createKeyResultSchema = keyResultUpsertSchema.omit({ id: true });

/** Sửa KR lồng: PUT /goals/:id/key-results/:krId (dùng cho cả ô cập nhật giá trị inline). */
export const updateKeyResultSchema = createKeyResultSchema.partial();

export const goalIssuesSchema = z.object({
  issueIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 issue').max(200),
});

export type KeyResultUpsertInput = z.infer<typeof keyResultUpsertSchema>;
export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type CreateKeyResultInput = z.infer<typeof createKeyResultSchema>;
export type UpdateKeyResultInput = z.infer<typeof updateKeyResultSchema>;
export type GoalIssuesInput = z.infer<typeof goalIssuesSchema>;
