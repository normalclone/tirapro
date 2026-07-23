import { z } from 'zod';

/** Zod cục bộ cho RolesModule (catalog + CRUD custom role). */
export const createRoleSchema = z.object({
  name: z.string().min(1, 'Tên vai trò bắt buộc').max(60),
  scope: z.enum(['WORKSPACE', 'PROJECT']),
  description: z.string().max(200).optional(),
  color: z.string().max(40).optional(),
  permissionKeys: z.array(z.string()).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(200).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  permissionKeys: z.array(z.string()).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
