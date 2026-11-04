import { z } from 'zod';

const name = z.string().trim().min(1, 'Tên team bắt buộc').max(60, 'Tên team tối đa 60 ký tự');
const color = z.string().max(40).nullable().optional();
const memberIds = z.array(z.string().min(1)).max(500);

export const createProjectSubTeamSchema = z.object({
  name,
  color,
  memberIds: memberIds.optional(),
});

export const updateProjectSubTeamSchema = z.object({
  name: name.optional(),
  color,
  memberIds: memberIds.optional(),
});

export const setProjectSubTeamMembersSchema = z.object({ memberIds });

export type CreateProjectSubTeamInput = z.infer<typeof createProjectSubTeamSchema>;
export type UpdateProjectSubTeamInput = z.infer<typeof updateProjectSubTeamSchema>;
export type SetProjectSubTeamMembersInput = z.infer<typeof setProjectSubTeamMembersSchema>;
