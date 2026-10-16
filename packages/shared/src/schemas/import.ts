import { z } from 'zod';

/** Giá trị mapping nghĩa là "tạo mới theo tên Jira" (khớp tên có sẵn trước, thiếu mới tạo). */
export const JIRA_CREATE = '__create__';

/** Mã ghi bởi `analyze` (cuid2, chữ thường + số) — chặn path traversal khi dùng làm tên file. */
export const jiraAnalyzeIdSchema = z
  .string()
  .regex(/^[a-z0-9]{8,40}$/, 'Mã phân tích không hợp lệ — hãy tải lại tệp');

export const jiraMappingSchema = z.object({
  /** Tên loại Jira → id IssueType hoặc `__create__`. */
  issueTypes: z.record(z.string().min(1)),
  /** Tên trạng thái Jira → id Status trong workflow của project đích hoặc `__create__`. */
  statuses: z.record(z.string().min(1)),
  /** Tên ưu tiên Jira → id Priority hoặc `__create__`. */
  priorities: z.record(z.string().min(1)),
  /** Tên người dùng Jira → id user thành viên workspace; null = để trống. Thiếu khoá = để trống. */
  users: z.record(z.string().nullable()).default({}),
});

export const jiraImportOptionsSchema = z.object({
  importComments: z.boolean().default(true),
  importSprints: z.boolean().default(true),
  /** Dùng mã Jira gốc (`JRA-1`) làm mã công việc; nhập lại cùng tệp thì bỏ qua việc đã có mã. Tắt = mã Tirapro tự sinh. */
  keepJiraKey: z.boolean().default(false),
  /** Chỉ kiểm tra và đếm, không ghi gì vào DB. */
  dryRun: z.boolean().default(false),
});

export const jiraImportRunSchema = z
  .object({
    analyzeId: jiraAnalyzeIdSchema,
    projectId: z.string().min(1).optional(),
    newProject: z
      .object({
        key: z
          .string()
          .min(2)
          .max(10)
          .regex(/^[A-Z][A-Z0-9]*$/, 'Key phải viết HOA, bắt đầu bằng chữ cái, 2-10 ký tự'),
        name: z.string().min(1).max(120),
      })
      .optional(),
    mapping: jiraMappingSchema,
    options: jiraImportOptionsSchema.default({}),
  })
  .refine((v) => Boolean(v.projectId) !== Boolean(v.newProject), {
    message: 'Hãy chọn một project có sẵn hoặc nhập thông tin project mới (chỉ một trong hai)',
    path: ['projectId'],
  });

export type JiraMappingInput = z.infer<typeof jiraMappingSchema>;
export type JiraImportOptions = z.infer<typeof jiraImportOptionsSchema>;
export type JiraImportRunInput = z.infer<typeof jiraImportRunSchema>;
