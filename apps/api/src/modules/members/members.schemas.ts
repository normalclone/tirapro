import { z } from 'zod';

export const setRolesSchema = z.object({
  roleIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 vai trò').max(20),
});

export const addProjectMemberSchema = z.object({
  userId: z.string().min(1),
  roleIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 vai trò').max(20),
});

export type SetRolesInput = z.infer<typeof setRolesSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
