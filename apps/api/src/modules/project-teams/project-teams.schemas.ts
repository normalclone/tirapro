import { z } from 'zod';

/** Gắn team vào dự án (hoặc đổi vai trò của team đã gắn): các vai trò DỰ ÁN mọi thành viên team nhận được. */
export const setProjectTeamSchema = z.object({
  roleIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 vai trò').max(20),
});

export type SetProjectTeamInput = z.infer<typeof setProjectTeamSchema>;
