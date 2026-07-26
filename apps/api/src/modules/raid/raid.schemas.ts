import { z } from 'zod';

export const raidKindEnum = z.enum(['RISK', 'ASSUMPTION', 'ISSUE', 'DEPENDENCY']);
export const raidStatusEnum = z.enum(['OPEN', 'MITIGATING', 'CLOSED', 'ACCEPTED']);

const scale = z.number().int().min(1, 'Giá trị từ 1 đến 5').max(5, 'Giá trị từ 1 đến 5');

export const createRaidSchema = z.object({
  kind: raidKindEnum.optional(),
  title: z.string().trim().min(1, 'Tiêu đề bắt buộc').max(200),
  description: z.string().max(4000).optional().nullable(),
  probability: scale.optional(),
  impact: scale.optional(),
  status: raidStatusEnum.optional(),
  projectId: z.string().min(1).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  mitigation: z.string().max(4000).optional().nullable(),
  /** ISO date (yyyy-mm-dd hoặc datetime đầy đủ). */
  dueDate: z.string().min(1).optional().nullable(),
});

export const updateRaidSchema = createRaidSchema.partial();

export type CreateRaidInput = z.infer<typeof createRaidSchema>;
export type UpdateRaidInput = z.infer<typeof updateRaidSchema>;
