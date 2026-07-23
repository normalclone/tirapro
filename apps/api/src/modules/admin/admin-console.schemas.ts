import { z } from 'zod';

/** Cập nhật 1 workspace từ admin console: đổi gói, lưu trữ/khôi phục, chuyển chủ sở hữu. */
export const patchWorkspaceSchema = z
  .object({
    plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']).optional(),
    archived: z.boolean().optional(),
    ownerId: z.string().min(1).optional(),
  })
  .refine((v) => v.plan !== undefined || v.archived !== undefined || v.ownerId !== undefined, {
    message: 'Cần ít nhất một thay đổi',
  });
export type PatchWorkspaceInput = z.infer<typeof patchWorkspaceSchema>;

/** Bật/tắt cờ hệ thống. */
export const updateFlagsSchema = z
  .object({
    signupEnabled: z.boolean().optional(),
    aiKillSwitch: z.boolean().optional(),
    integrationsEnabled: z.boolean().optional(),
    maintenanceBanner: z.string().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Không có thay đổi' });
export type UpdateFlagsInput = z.infer<typeof updateFlagsSchema>;

/** Truy vấn nhật ký kiểm toán. */
export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  workspaceId: z.string().optional(),
  action: z.string().optional(),
});
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
