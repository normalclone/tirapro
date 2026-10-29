import { z } from 'zod';

/**
 * Zod schemas cục bộ cho các flow auth mở rộng (switch-workspace).
 * Đặt trong module auth vì module này sở hữu các endpoint tương ứng.
 */

export const switchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId bắt buộc'),
});

export type SwitchWorkspaceInput = z.infer<typeof switchWorkspaceSchema>;
