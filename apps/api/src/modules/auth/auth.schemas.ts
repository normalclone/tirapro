import { z } from 'zod';

/**
 * Zod schemas cục bộ cho các flow auth mở rộng (switch-organization).
 * Đặt trong module auth vì module này sở hữu các endpoint tương ứng.
 */

export const switchOrganizationSchema = z.object({
  organizationId: z.string().min(1, 'organizationId bắt buộc'),
});

export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>;
