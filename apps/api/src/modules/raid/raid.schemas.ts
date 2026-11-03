import { z } from 'zod';

const raidKindEnum = z.enum(['RISK', 'ASSUMPTION', 'ISSUE', 'DEPENDENCY']);
const raidStatusEnum = z.enum(['OPEN', 'MITIGATING', 'CLOSED', 'ACCEPTED']);

const scale = z.number().int().min(1, 'Giá trị từ 1 đến 5').max(5, 'Giá trị từ 1 đến 5');

export const createRaidSchema = z.object({
  kind: raidKindEnum.optional(),
  title: z.string().trim().min(1, 'Tiêu đề bắt buộc').max(200),
  description: z.string().max(4000).optional().nullable(),
  probability: scale.optional(),
  impact: scale.optional(),
  status: raidStatusEnum.optional(),
  projectId: z.string().min(1).optional().nullable(),
  /** Người phụ trách CHÍNH (cũ) — nhận một người; ưu tiên dùng `ownerIds`. */
  ownerId: z.string().min(1).optional().nullable(),
  /** Một hoặc nhiều người phụ trách (người đầu = chính). Rỗng = chưa giao. */
  ownerIds: z.array(z.string().min(1)).max(20, 'Tối đa 20 người phụ trách').optional(),
  mitigation: z.string().max(4000).optional().nullable(),
  /** ISO date (yyyy-mm-dd hoặc datetime đầy đủ). */
  dueDate: z.string().min(1).optional().nullable(),
});

export const updateRaidSchema = createRaidSchema.partial();

export type CreateRaidInput = z.infer<typeof createRaidSchema>;
export type UpdateRaidInput = z.infer<typeof updateRaidSchema>;
