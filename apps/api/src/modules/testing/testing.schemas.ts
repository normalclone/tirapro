import { z } from 'zod';

/** Kết quả một lần chạy ca kiểm thử (mirror enum TestResult của Prisma). */
export const testResultEnum = z.enum(['UNTESTED', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED']);

export const createTestCaseSchema = z.object({
  title: z.string().min(1, 'Tiêu đề bắt buộc').max(255),
  precondition: z.string().max(5_000).optional().nullable(),
  steps: z.string().max(20_000).optional().nullable(),
  expected: z.string().max(20_000).optional().nullable(),
  folder: z.string().max(120).optional().nullable(),
  ownerId: z.string().optional().nullable(),
  /** Gắn sẵn issue lúc tạo (traceability). */
  issueIds: z.array(z.string().min(1)).max(100).optional(),
});

export const updateTestCaseSchema = createTestCaseSchema.partial();

export const testCaseIssuesSchema = z.object({
  issueIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 issue').max(100),
});

export const createTestRunSchema = z.object({
  name: z.string().min(1, 'Tên đợt chạy bắt buộc').max(160),
  description: z.string().max(2_000).optional().nullable(),
  /** Thêm sẵn ca kiểm thử vào đợt chạy (mỗi ca → 1 lượt chạy UNTESTED). */
  caseIds: z.array(z.string().min(1)).max(1_000).optional(),
});

export const updateTestRunSchema = z.object({
  name: z.string().min(1, 'Tên đợt chạy bắt buộc').max(160).optional(),
  description: z.string().max(2_000).optional().nullable(),
  /** true = kết thúc đợt chạy, false = mở lại. */
  finished: z.boolean().optional(),
});

export const addRunCasesSchema = z.object({
  caseIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 ca kiểm thử').max(1_000),
});

export const setExecutionSchema = z.object({
  result: testResultEnum,
  note: z.string().max(5_000).optional().nullable(),
});

export const createBugFromExecutionSchema = z.object({
  /** Ghi đè tiêu đề/mô tả bug (mặc định lấy từ ca kiểm thử + ghi chú lượt chạy). */
  summary: z.string().min(1).max(255).optional(),
  description: z.string().max(20_000).optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  priorityId: z.string().optional().nullable(),
});

export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;
export type UpdateTestCaseInput = z.infer<typeof updateTestCaseSchema>;
export type TestCaseIssuesInput = z.infer<typeof testCaseIssuesSchema>;
export type CreateTestRunInput = z.infer<typeof createTestRunSchema>;
export type UpdateTestRunInput = z.infer<typeof updateTestRunSchema>;
export type AddRunCasesInput = z.infer<typeof addRunCasesSchema>;
export type SetExecutionInput = z.infer<typeof setExecutionSchema>;
export type CreateBugFromExecutionInput = z.infer<typeof createBugFromExecutionSchema>;
