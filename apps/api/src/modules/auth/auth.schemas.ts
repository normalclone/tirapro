import { z } from 'zod';

/**
 * Zod schemas cục bộ cho các flow auth mở rộng (switch-workspace + invite).
 * Đặt trong module auth vì module này sở hữu các endpoint tương ứng.
 */

export const switchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId bắt buộc'),
});

export const inviteMemberSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase(),
  displayName: z.string().min(1, 'Tên hiển thị bắt buộc').max(120),
  roleId: z.string().min(1).optional(), // vai trò chính (tương thích ngược)
  roleIds: z.array(z.string().min(1)).max(20).optional(), // nhiều vai trò
});

export type SwitchWorkspaceInput = z.infer<typeof switchWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
