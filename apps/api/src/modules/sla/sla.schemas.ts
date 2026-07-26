import { z } from 'zod';

export const createSlaPolicySchema = z.object({
  name: z.string().min(1, 'Tên chính sách bắt buộc').max(120),
  projectId: z.string().optional().nullable(),
  priorityId: z.string().optional().nullable(),
  responseMins: z.number().int().min(1).max(60 * 24 * 30),
  resolveMins: z.number().int().min(1).max(60 * 24 * 365),
  active: z.boolean().optional(),
});

export const updateSlaPolicySchema = createSlaPolicySchema.partial();

export type CreateSlaPolicyInput = z.infer<typeof createSlaPolicySchema>;
export type UpdateSlaPolicyInput = z.infer<typeof updateSlaPolicySchema>;
