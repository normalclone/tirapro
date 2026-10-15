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

export const fieldConditionSchema = z.object({
  field: z.enum(RULE_CONDITION_FIELDS),
  op: z.enum(RULE_CONDITION_OPS),
  value: z.unknown().optional(),
});
export const jqlConditionSchema = z.object({
  jql: z.string().trim().min(1, 'JQL không được để trống').max(2000),
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
const webhookAction = z.object({
  type: z.literal('webhook'),
  url: z
    .string()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'Chỉ hỗ trợ http hoặc https'),
  secret: z.string().max(200).optional(),
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

export const listRulesQuerySchema = z.object({ projectId: z.string().optional() });

export type RuleTriggerValue = (typeof RULE_TRIGGERS)[number];
export type RuleCondition = z.infer<typeof ruleConditionSchema>;
export type RuleAction = z.infer<typeof ruleActionSchema>;
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type TestRuleInput = z.infer<typeof testRuleSchema>;
