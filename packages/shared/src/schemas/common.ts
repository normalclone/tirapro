import { z } from 'zod';

export const cuidSchema = z.string().min(1);

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const offsetPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Tên workspace bắt buộc').max(120),
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  key: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z][A-Z0-9]*$/, 'Key phải viết HOA, bắt đầu bằng chữ cái, 2-10 ký tự'),
  type: z.enum(['SCRUM', 'KANBAN']).default('SCRUM'),
  description: z.string().max(2000).optional().nullable(),
  leadId: z.string().optional().nullable(),
});

export const createCommentSchema = z.object({
  body: z.string().min(1, 'Nội dung bắt buộc').max(50_000),
  bodyFormat: z.enum(['MARKDOWN', 'TIPTAP_JSON']).default('TIPTAP_JSON'),
  parentId: z.string().optional().nullable(),
  mentionUserIds: z.array(z.string()).optional(),
});

export const createSprintSchema = z.object({
  name: z.string().min(1).max(120),
  goal: z.string().max(1000).optional().nullable(),
  boardId: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type CreateSprintInput = z.infer<typeof createSprintSchema>;
