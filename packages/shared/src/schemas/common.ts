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
  name: z.string().min(1, 'Tên không gian làm việc bắt buộc').max(120),
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  key: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z][A-Z0-9]*$/, 'Key phải viết HOA, bắt đầu bằng chữ cái, 2-10 ký tự'),
  type: z.enum(['SCRUM', 'KANBAN']).default('SCRUM'),
  /** Mẫu dự án (quy trình + cột sinh sẵn). Có thì thắng `type`; bỏ trống = hành vi cũ theo `type`. */
  templateKey: z.enum(['scrum', 'kanban', 'requirements']).optional(),
  description: z.string().max(2000).optional().nullable(),
  leadId: z.string().optional().nullable(),
  /** Dự án riêng tư — chỉ thành viên dự án + quản trị thấy. Mặc định false. */
  isPrivate: z.boolean().optional(),
});

export const createCommentSchema = z.object({
  body: z.string().min(1, 'Nội dung bắt buộc').max(50_000),
  bodyFormat: z.enum(['MARKDOWN', 'TIPTAP_JSON']).default('TIPTAP_JSON'),
  parentId: z.string().optional().nullable(),
  mentionUserIds: z.array(z.string()).max(20).optional(),
});

/** Sửa bình luận: `version` để phát hiện sửa đồng thời (409). Giới hạn độ dài khớp lúc tạo. */
export const updateCommentSchema = z.object({
  body: z.string().min(1, 'Nội dung bắt buộc').max(50_000, 'Nội dung quá dài'),
  version: z.number().int('Phiên bản không hợp lệ'),
});

/**
 * Bộ emoji thả vào bình luận — CỐ ĐỊNH 6 (RC24; không 👎 trong công cụ làm việc, không emoji tự do: an toàn kích thước/XSS,
 * thống kê dễ). Thứ tự này cũng là thứ tự chip và ô chọn. Đổi bộ = sửa hằng này (cột DB không ràng buộc).
 */
export const COMMENT_REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🙏', '👀'] as const;
export type CommentReactionEmoji = (typeof COMMENT_REACTION_EMOJIS)[number];
export const commentReactionEmojiSchema = z.enum(COMMENT_REACTION_EMOJIS);

/** Kiểm tra cú pháp JQL — chỉ nhận chuỗi, không đọc dữ liệu. */
export const validateJqlSchema = z.object({
  jql: z.string().max(5_000, 'JQL quá dài').optional(),
});

/**
 * Đếm "nếu bỏ từng điều kiện" khi bộ lọc không có kết quả (092). `projectId` trong body: guard phân quyền đọc đúng
 * trường này (`@ProjectRef('body', 'projectId')`). Cùng giới hạn độ dài với `validateJqlSchema`.
 */
export const relaxCountsSchema = z.object({
  jql: z.string().trim().min(1, 'Thiếu JQL').max(5_000, 'JQL quá dài'),
  projectId: z.string().min(1).optional(),
});

export const createSprintSchema = z.object({
  /** Bắt buộc trong body: guard phân quyền đọc đúng trường này (`@ProjectRef('body', 'projectId')`). */
  projectId: z.string().min(1, 'Thiếu dự án'),
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
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ValidateJqlInput = z.infer<typeof validateJqlSchema>;
export type RelaxCountsInput = z.infer<typeof relaxCountsSchema>;
export type CreateSprintInput = z.infer<typeof createSprintSchema>;
