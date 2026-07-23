import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(1, 'Tên nhóm bắt buộc').max(60),
  key: z.string().max(30).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  color: z.string().max(40).optional().nullable(),
  leadId: z.string().optional().nullable(),
  memberIds: z.array(z.string().min(1)).max(500).optional(),
});

export const updateTeamSchema = createTeamSchema.partial();

export const setTeamMembersSchema = z.object({
  memberIds: z.array(z.string().min(1)).max(500),
});

export const assignTeamToProjectSchema = z.object({
  projectId: z.string().min(1),
  roleIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 vai trò').max(20),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type SetTeamMembersInput = z.infer<typeof setTeamMembersSchema>;
export type AssignTeamToProjectInput = z.infer<typeof assignTeamToProjectSchema>;
