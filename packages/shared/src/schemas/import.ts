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
  /**
   * Tên người dùng Jira CHƯA ghép → email (L28): nhớ để tự gán việc khi họ được thêm vào workspace.
   * Chỉ có tác dụng với người không có khoá trong `users`; khớp theo email, không đoán theo tên.
   */
  pendingEmails: z.record(z.string().email()).default({}),
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
    message: 'Hãy chọn một dự án có sẵn hoặc nhập thông tin dự án mới (chỉ một trong hai)',
    path: ['projectId'],
  });

export type JiraMappingInput = z.infer<typeof jiraMappingSchema>;
export type JiraImportOptions = z.infer<typeof jiraImportOptionsSchema>;
export type JiraImportRunInput = z.infer<typeof jiraImportRunSchema>;

/* ---- Nhập từ biểu mẫu Excel ---- */

/** Giới hạn của biểu mẫu Excel (API và web dùng chung). */
export const EXCEL_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const EXCEL_IMPORT_MAX_ROWS = 1000;

export const excelImportBodySchema = z.object({
  projectId: z.string().min(1, 'Thiếu mã dự án'),
});
export type ExcelImportBody = z.infer<typeof excelImportBodySchema>;

export interface ExcelRowIssue {
  /** Tên cột trong biểu mẫu (vd "Người phụ trách"). */
  column: string;
  message: string;
}

export interface ExcelPreviewRow {
  /** Số dòng Excel thật (dòng 1 là tiêu đề nên dữ liệu bắt đầu từ 2). */
  row: number;
  /** Tiêu đề công việc (để người dùng nhận ra dòng) — có thể rỗng khi thiếu. */
  summary: string;
  errors: ExcelRowIssue[];
  warnings: ExcelRowIssue[];
}

export interface ExcelPreviewResult {
  total: number;
  valid: number;
  invalid: number;
  rows: ExcelPreviewRow[];
}

export interface ExcelImportRowError {
  row: number;
  error: string;
}

export interface ExcelImportResult {
  jobId: string;
  source: 'EXCEL';
  created: number;
  failed: number;
  total: number;
  errors: ExcelImportRowError[];
}
