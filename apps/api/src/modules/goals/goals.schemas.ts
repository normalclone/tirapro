import { z } from 'zod';

export const objectiveStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'CLOSED']);
export const keyResultUnitEnum = z.enum(['NUMBER', 'PERCENT', 'CURRENCY']);

export const keyResultSourceEnum = z.enum([
  'MANUAL',
  'OPEN_BUGS',
  'SPRINT_COMPLETION',
  'ISSUE_COUNT_JQL',
]);

/** Cấu hình theo nguồn số liệu (L25). `MANUAL` không có cấu hình. */
const sourceConfigSchemas = {
  OPEN_BUGS: z.object({ projectId: z.string().min(1).optional() }), // bỏ trống = mọi dự án người xem thấy
  SPRINT_COMPLETION: z.object({ projectId: z.string().min(1, 'Chọn dự án có sprint cần đo') }),
  ISSUE_COUNT_JQL: z.object({
    jql: z.string().trim().min(1, 'Nhập câu JQL cần đếm').max(500, 'JQL tối đa 500 ký tự'),
  }),
} as const;

export type KeyResultSourceKey = z.infer<typeof keyResultSourceEnum>;
export type KeyResultSourceConfig = { projectId?: string } | { jql: string } | null;

/** Kiểm + chuẩn hoá cấu hình theo nguồn; `MANUAL` → `null`. Ném ZodError nếu sai. */
export function parseSourceConfig(source: KeyResultSourceKey, raw: unknown): KeyResultSourceConfig {
  if (source === 'MANUAL') return null;
  return sourceConfigSchemas[source].parse(raw ?? {});
}

function checkSourceConfig(source: KeyResultSourceKey, raw: unknown, ctx: z.RefinementCtx): void {
  if (source === 'MANUAL') return;
  const res = sourceConfigSchemas[source].safeParse(raw ?? {});
  if (res.success) return;
  for (const issue of res.error.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceConfig', ...issue.path],
      message: issue.message,
    });
  }
}

/**
 * Kết quả then chốt (Key Result) trong payload mục tiêu.
 * Có `id` → cập nhật KR đó; không có `id` → tạo mới. KR cũ không xuất hiện trong
 * mảng gửi lên sẽ bị xoá (semantics "thay cả danh sách nhưng giữ id").
 * `source` != MANUAL (tự đo): `currentValue` gửi lên bị bỏ qua, `sourceConfig` bắt buộc đúng theo nguồn.
 */
const keyResultFields = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, 'Tên kết quả then chốt bắt buộc').max(160),
  unit: keyResultUnitEnum.optional(),
  startValue: z.number().finite().optional(),
  targetValue: z.number().finite(),
  currentValue: z.number().finite().optional(),
  source: keyResultSourceEnum.optional(),
  sourceConfig: z.record(z.unknown()).nullable().optional(),
});

export const keyResultUpsertSchema = keyResultFields.superRefine((kr, ctx) =>
  checkSourceConfig(kr.source ?? 'MANUAL', kr.sourceConfig, ctx),
);

export const createGoalSchema = z.object({
  name: z.string().trim().min(1, 'Tên mục tiêu bắt buộc').max(160),
  description: z.string().max(2000).optional().nullable(),
  period: z.string().trim().min(1, 'Kỳ bắt buộc').max(30),
  status: objectiveStatusEnum.optional(),
  projectId: z.string().min(1).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  keyResults: z.array(keyResultUpsertSchema).max(30).optional(),
  issueIds: z.array(z.string().min(1)).max(200).optional(),
});

export const updateGoalSchema = createGoalSchema.partial();

/** Tạo KR lồng: POST /goals/:id/key-results */
export const createKeyResultSchema = keyResultFields
  .omit({ id: true })
  .superRefine((kr, ctx) => checkSourceConfig(kr.source ?? 'MANUAL', kr.sourceConfig, ctx));

/** Sửa KR lồng: PUT /goals/:id/key-results/:krId (dùng cho cả ô cập nhật giá trị inline). */
export const updateKeyResultSchema = keyResultFields
  .omit({ id: true })
  .partial()
  // Có `source` thì kiểm cấu hình ngay; chỉ có `sourceConfig` (không đổi nguồn) thì service kiểm theo nguồn hiện tại.
  .superRefine((kr, ctx) => {
    if (kr.source !== undefined) checkSourceConfig(kr.source, kr.sourceConfig, ctx);
  });

export const goalIssuesSchema = z.object({
  issueIds: z.array(z.string().min(1)).min(1, 'Hãy chọn ít nhất một công việc').max(200),
});

export type KeyResultUpsertInput = z.infer<typeof keyResultUpsertSchema>;
export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type CreateKeyResultInput = z.infer<typeof createKeyResultSchema>;
export type UpdateKeyResultInput = z.infer<typeof updateKeyResultSchema>;
export type GoalIssuesInput = z.infer<typeof goalIssuesSchema>;
