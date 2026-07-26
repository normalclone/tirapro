import { z } from 'zod';

/** Các trường mặc định của issue được lưu trong `payload` (Json) của mẫu / việc lặp lại. */
export const issuePayloadSchema = z.object({
  typeId: z.string().min(1).optional().nullable(),
  priorityId: z.string().min(1).optional().nullable(),
  summary: z.string().max(255).optional().nullable(),
  description: z.string().max(50_000).optional().nullable(),
  assigneeId: z.string().min(1).optional().nullable(),
  labelIds: z.array(z.string().min(1)).max(50).optional(),
  storyPoints: z.number().min(0).max(1000).optional().nullable(),
});

export type IssuePayload = z.infer<typeof issuePayloadSchema>;

/* ------------------------------ Mẫu issue ------------------------------ */

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Tên mẫu bắt buộc').max(120),
  description: z.string().max(500).optional().nullable(),
  /** null = mẫu dùng chung cho mọi dự án trong workspace. */
  projectId: z.string().min(1).optional().nullable(),
  payload: issuePayloadSchema.optional().default({}),
});

export const updateTemplateSchema = createTemplateSchema.partial();

/* ----------------------------- Việc lặp lại ---------------------------- */

export const recurrenceFreqSchema = z.enum(['DAILY', 'WEEKLY', 'MONTHLY']);

export const createRecurringSchema = z.object({
  projectId: z.string().min(1, 'Chọn dự án'),
  name: z.string().min(1, 'Tên việc lặp lại bắt buộc').max(120),
  freq: recurrenceFreqSchema.default('WEEKLY'),
  interval: z.number().int().min(1).max(52).optional().default(1),
  /** 0 = Chủ nhật … 6 = Thứ 7 (dùng cho WEEKLY). */
  weekday: z.number().int().min(0).max(6).optional().nullable(),
  /** Ngày trong tháng 1..31 (dùng cho MONTHLY); tháng ngắn hơn sẽ lùi về ngày cuối. */
  monthDay: z.number().int().min(1).max(31).optional().nullable(),
  hour: z.number().int().min(0).max(23).optional().default(8),
  active: z.boolean().optional().default(true),
  payload: issuePayloadSchema.optional().default({}),
});

export const updateRecurringSchema = createRecurringSchema.partial().omit({ projectId: true });

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;
