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
  severityId: z.string().optional().nullable(),
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
    // Ước lượng thời gian (giây). Ước lượng còn lại do worklog tự trừ; sửa tay khi cần.
    originalEstimate: z.number().int().min(0).max(100_000_000).optional().nullable(),
    remainingEstimate: z.number().int().min(0).max(100_000_000).optional().nullable(),
  });

export const transitionIssueSchema = z.object({
  toStatusId: z.string().min(1),
  resolutionId: z.string().optional().nullable(),
  version: z.number().int().nonnegative(),
  /** Board đang thao tác (web gửi kèm) — để kiểm giới hạn WIP của cột đích. */
  boardId: z.string().min(1).optional(),
  /** "Vẫn chuyển" khi cột đã đầy WIP — chỉ người có `project:admin` được dùng. */
  force: z.boolean().optional(),
});

/**
 * Sửa hàng loạt: cùng một `patch` áp cho nhiều issue của MỘT dự án, mỗi item kèm version đang giữ (OCC).
 * Item nào bị người khác sửa trước sẽ nằm trong `conflicts`, không làm hỏng cả lô.
 */
export const bulkUpdateIssuesSchema = z.object({
  projectId: z.string().min(1),
  boardId: z.string().min(1).optional(),
  force: z.boolean().optional(),
  items: z
    .array(z.object({ id: z.string().min(1), version: z.number().int().nonnegative() }))
    .min(1, 'Hãy chọn ít nhất một công việc')
    .max(100, 'Mỗi lần chỉ sửa tối đa 100 công việc')
    .refine(
      (items) => new Set(items.map((i) => i.id)).size === items.length,
      'Có công việc bị chọn trùng',
    ),
  patch: z
    .object({
      statusId: z.string().min(1).optional(),
      assigneeId: z.string().min(1).nullable().optional(),
      priorityId: z.string().min(1).nullable().optional(),
      sprintId: z.string().min(1).nullable().optional(),
    })
    .refine((p) => Object.values(p).some((v) => v !== undefined), 'Hãy chọn ít nhất một thay đổi'),
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
  boardId: z.string().min(1).optional(),
  force: z.boolean().optional(),
});

/** Chỉ xếp lại thứ tự / đổi sprint (không đổi trạng thái): dùng cho Backlog, quyền `backlog:manage` + `issue:edit`. */
export const rankIssueSchema = moveIssueSchema.pick({
  beforeId: true,
  afterId: true,
  sprintId: true,
  version: true,
});

export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
export type TransitionIssueInput = z.infer<typeof transitionIssueSchema>;
export type MoveIssueInput = z.infer<typeof moveIssueSchema>;
export type RankIssueInput = z.infer<typeof rankIssueSchema>;
export type BulkUpdateIssuesInput = z.infer<typeof bulkUpdateIssuesSchema>;
export type LinkIssueInput = z.infer<typeof linkIssueSchema>;
