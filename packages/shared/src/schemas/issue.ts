import { z } from 'zod';

// priority/resolution/linkType giờ là config (FK theo id), không còn enum cứng.
export const richTextFormatEnum = z.enum(['MARKDOWN', 'TIPTAP_JSON']);

export const createIssueSchema = z.object({
  projectId: z.string().min(1),
  typeId: z.string().min(1),
  summary: z.string().min(1, 'Tiêu đề bắt buộc').max(255),
  description: z.string().max(50_000).optional().nullable(),
  descriptionFormat: richTextFormatEnum.default('MARKDOWN'),
  priorityId: z.string().optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  epicId: z.string().optional().nullable(),
  sprintId: z.string().optional().nullable(),
  storyPoints: z.number().min(0).max(1000).optional().nullable(),
  labelIds: z.array(z.string()).optional(),
  statusId: z.string().optional(),
  dueDate: z.string().datetime().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  // cho optimistic create từ client (client sinh cuid)
  clientId: z.string().optional(),
});

export const updateIssueSchema = createIssueSchema
  .partial()
  .omit({ projectId: true, clientId: true })
  .extend({
    // OCC: bắt buộc gửi version hiện tại khi update
    version: z.number().int().nonnegative(),
    resolutionId: z.string().optional().nullable(),
  });

export const transitionIssueSchema = z.object({
  toStatusId: z.string().min(1),
  resolutionId: z.string().optional().nullable(),
  version: z.number().int().nonnegative(),
});

export const linkIssueSchema = z.object({
  targetIssueId: z.string().min(1),
  linkTypeId: z.string().min(1),
});

export const moveIssueSchema = z.object({
  // rank-based ordering: thả giữa beforeId/afterId
  beforeId: z.string().optional().nullable(),
  afterId: z.string().optional().nullable(),
  statusId: z.string().optional(),
  sprintId: z.string().optional().nullable(),
  version: z.number().int().nonnegative(),
});

export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
export type TransitionIssueInput = z.infer<typeof transitionIssueSchema>;
export type MoveIssueInput = z.infer<typeof moveIssueSchema>;
export type LinkIssueInput = z.infer<typeof linkIssueSchema>;
