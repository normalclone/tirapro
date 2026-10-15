import { z } from 'zod';

/** Truy vấn nhật ký quản trị của workspace (`GET /audit`). */
export const auditListSchema = z.object({
  action: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditListInput = z.infer<typeof auditListSchema>;
