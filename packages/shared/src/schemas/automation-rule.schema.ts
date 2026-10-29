import { z } from 'zod';

export const RULE_TRIGGERS = [
  'ISSUE_CREATED',
  'ISSUE_TRANSITIONED',
  'ISSUE_UPDATED',
  'COMMENT_ADDED',
  'SCHEDULED',
] as const;
export const ruleTriggerSchema = z.enum(RULE_TRIGGERS);

/** Trường issue mà điều kiện có thể so sánh. `labelIds` là mảng, các trường còn lại là giá trị đơn. */
export const RULE_CONDITION_FIELDS = [
  'statusId',
  'priorityId',
  'assigneeId',
  'reporterId',
  'typeId',
  'sprintId',
  'resolutionId',
  'storyPoints',
  'summary',
  'labelIds',
  'dueDate',
] as const;
export const RULE_CONDITION_OPS = [
  'eq',
  'neq',
  'in',
  'nin',
  'empty',
  'notEmpty',
  'contains',
] as const;

/**
 * Chuỗi mà Postgres/Prisma không nhận được: ký tự NUL (`\u0000` — "invalid byte sequence", jsonb cũng từ chối) hoặc
 * surrogate UTF-16 lẻ (không tuần tự hoá được sang UTF-8). Quét sâu cả khoá đối tượng, vì `value` của điều kiện là
 * `unknown`. Không được lọt tới DB: nếu lọt, kết quả là lỗi 500 thay vì 400.
 */
export function containsUnstorableText(v: unknown): boolean {
  if (typeof v === 'string') return v.includes('\u0000') || !isWellFormedUtf16(v);
  if (Array.isArray(v)) return v.some(containsUnstorableText);
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).some(
      ([k, x]) => containsUnstorableText(k) || containsUnstorableText(x),
    );
  }
  return false;
}

function isWellFormedUtf16(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

const UNSTORABLE_MESSAGE = 'Giá trị chứa ký tự không hợp lệ (ký tự NUL hoặc UTF-16 hỏng)';

export const fieldConditionSchema = z
  .object({
    field: z.enum(RULE_CONDITION_FIELDS),
    op: z.enum(RULE_CONDITION_OPS),
    value: z.unknown().optional(),
  })
  .refine((c) => !containsUnstorableText(c.value), {
    message: UNSTORABLE_MESSAGE,
    path: ['value'],
  });
export const jqlConditionSchema = z.object({
  jql: z
    .string()
    .trim()
    .min(1, 'JQL không được để trống')
    .max(2000)
    .refine((j) => !containsUnstorableText(j), UNSTORABLE_MESSAGE),
});
export const ruleConditionSchema = z.union([fieldConditionSchema, jqlConditionSchema]);

export const SET_FIELD_NAMES = [
  'priorityId',
  'assigneeId',
  'sprintId',
  'dueDate',
  'storyPoints',
] as const;

const setFieldAction = z.object({
  type: z.literal('setField'),
  field: z.enum(SET_FIELD_NAMES),
  value: z.union([z.string(), z.number(), z.null()]),
});
const assignAction = z.object({
  type: z.literal('assign'),
  mode: z.enum(['reporter', 'lead', 'user', 'roundRobin']),
  userId: z.string().min(1).optional(),
});
const transitionAction = z.object({ type: z.literal('transition'), toStatusId: z.string().min(1) });
const addLabelAction = z.object({ type: z.literal('addLabel'), labelId: z.string().min(1) });
const removeLabelAction = z.object({ type: z.literal('removeLabel'), labelId: z.string().min(1) });
const addCommentAction = z.object({
  type: z.literal('addComment'),
  body: z.string().trim().min(1).max(5000),
});
const notifyAction = z.object({
  type: z.literal('notify'),
  userIds: z.array(z.string().min(1)).max(50).optional(),
  roles: z.array(z.string().min(1)).max(20).optional(),
  message: z.string().trim().min(1).max(500),
});
/** Tiền tố của khoá bí mật webhook đã mã hoá (dạng lưu trong DB); API tự thêm khi lưu. */
export const WEBHOOK_SECRET_PREFIX = 'enc:v1:';
/** Giới hạn khoá bí mật người dùng nhập (plaintext, tính theo đơn vị UTF-16 như `string.length`). */
export const WEBHOOK_SECRET_MAX_LENGTH = 200;
/**
 * Giới hạn dạng ĐÃ MÃ HOÁ: tiền tố + hex(iv 12B + tag 16B + ct ≤ 3 byte/đơn vị × 200) + 2 dấu ':' ≈ 1265 ký tự.
 * Engine parse actions ở dạng lưu nên schema phải nhận đủ dài; plaintext vẫn bị chặn ở WEBHOOK_SECRET_MAX_LENGTH.
 */
export const WEBHOOK_SECRET_STORED_MAX_LENGTH = 2048;

const webhookAction = z.object({
  type: z.literal('webhook'),
  url: z
    .string()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'Chỉ hỗ trợ http hoặc https'),
  secret: z
    .string()
    .max(WEBHOOK_SECRET_STORED_MAX_LENGTH)
    .refine(
      (v) => v.startsWith(WEBHOOK_SECRET_PREFIX) || v.length <= WEBHOOK_SECRET_MAX_LENGTH,
      `Khoá bí mật tối đa ${WEBHOOK_SECRET_MAX_LENGTH} ký tự`,
    )
    .optional(),
});
const createSubtaskAction = z.object({
  type: z.literal('createSubtask'),
  summary: z.string().trim().min(1).max(255),
  typeId: z.string().min(1),
});

/** Zod 3 không cho discriminatedUnion chứa ZodEffects → kiểm tra chéo trường nằm ở superRefine của cả union. */
export const ruleActionSchema = z
  .discriminatedUnion('type', [
    setFieldAction,
    assignAction,
    transitionAction,
    addLabelAction,
    removeLabelAction,
    addCommentAction,
    notifyAction,
    webhookAction,
    createSubtaskAction,
  ])
  .superRefine((a, ctx) => {
    const bad = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (a.type === 'setField') {
      if (a.field === 'storyPoints') {
        if (a.value !== null && (typeof a.value !== 'number' || a.value < 0 || a.value > 1000))
          bad('value', 'Story points phải là số từ 0 đến 1000');
      } else if (a.field === 'dueDate') {
        if (a.value !== null && (typeof a.value !== 'string' || Number.isNaN(Date.parse(a.value))))
          bad('value', 'Hạn phải là ngày hợp lệ');
      } else if (a.value !== null && (typeof a.value !== 'string' || !a.value)) {
        bad('value', 'Giá trị phải là một mã (id) hoặc để trống');
      }
    } else if (a.type === 'assign') {
      if (a.mode === 'user' && !a.userId) bad('userId', 'Hãy chọn người được giao');
    } else if (a.type === 'notify') {
      if ((a.userIds?.length ?? 0) + (a.roles?.length ?? 0) === 0)
        bad('userIds', 'Hãy chọn người hoặc vai trò nhận thông báo');
    }
  });

export const triggerConfigSchema = z.object({
  /** ISSUE_UPDATED: chỉ chạy khi một trong các trường này vừa đổi (bỏ trống = mọi lần sửa). */
  fields: z.array(z.string().min(1)).max(20).optional(),
  /** SCHEDULED: biểu thức cron 5 trường (phút giờ ngày tháng thứ). */
  cron: z.string().trim().max(100).optional(),
  /** ISSUE_TRANSITIONED: chỉ khi chuyển ĐẾN trạng thái này (bỏ trống = mọi lần chuyển). */
  toStatusId: z.string().min(1).optional(),
});

const ruleBody = {
  name: z.string().trim().min(1, 'Hãy đặt tên cho quy tắc').max(120),
  enabled: z.boolean().optional(),
  trigger: ruleTriggerSchema,
  triggerConfig: triggerConfigSchema.default({}),
  conditions: z.array(ruleConditionSchema).max(20).default([]),
  actions: z.array(ruleActionSchema).min(1, 'Hãy thêm ít nhất một hành động').max(20),
};

export const createRuleSchema = z.object({
  projectId: z.string().min(1).optional().nullable(),
  ...ruleBody,
});

export const updateRuleSchema = z
  .object({
    name: ruleBody.name.optional(),
    enabled: z.boolean().optional(),
    trigger: ruleTriggerSchema.optional(),
    triggerConfig: triggerConfigSchema.optional(),
    conditions: z.array(ruleConditionSchema).max(20).optional(),
    actions: ruleBody.actions.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Hãy sửa ít nhất một trường');

export const testRuleSchema = z.object({
  issueKey: z.string().trim().min(1, 'Hãy nhập mã công việc, ví dụ DEMO-TASK-1'),
});

/**
 * Xem trước "khớp N việc hiện có" của danh sách điều kiện (chưa lưu quy tắc). `projectId` trong body: guard phân quyền
 * đọc đúng trường này (`@ProjectRef('body', 'projectId')`); không có = quy tắc cấp workspace.
 */
export const previewMatchSchema = z.object({
  projectId: z.string().min(1).optional(),
  conditions: z.array(ruleConditionSchema).max(20),
});

export const listRulesQuerySchema = z.object({ projectId: z.string().optional() });

export type RuleTriggerValue = (typeof RULE_TRIGGERS)[number];
export type RuleCondition = z.infer<typeof ruleConditionSchema>;
export type RuleAction = z.infer<typeof ruleActionSchema>;
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type TestRuleInput = z.infer<typeof testRuleSchema>;
export type PreviewMatchInput = z.infer<typeof previewMatchSchema>;

/** Quy tắc theo lịch xử lý tối đa chừng này việc mỗi lần chạy (engine dùng; xem trước nhắc người soạn khi số khớp vượt). */
export const SCHEDULED_RUN_ISSUE_LIMIT = 500;

/** Phản hồi `POST /automation/rules/preview-match` — API trả, web dùng (một định nghĩa duy nhất). */
export interface PreviewMatchResult {
  /** Số việc hiện có khớp MỌI điều kiện (trong phạm vi người soạn xem được); `null` = không đếm được (xem `reason`/`timedOut`). */
  count: number | null;
  /** Lý do không xem trước được (điều kiện không diễn đạt chính xác được, JQL sai cú pháp, giá trị không hợp lệ); `null` nếu không có. */
  reason: string | null;
  /** Đếm quá hạn (statement_timeout, hoặc không có chỗ trước hạn tổng). */
  timedOut: boolean;
  /** Có điều kiện JQL dùng `currentUser()`/`me`: trong tự động hoá nó là người dùng hệ thống, không phải ai đang xem. */
  currentUserInJql: boolean;
}
