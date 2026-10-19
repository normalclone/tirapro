import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AutomationRuleDto,
  AutomationRuleTestResultDto,
  AutomationRunDto,
  RuleTrigger,
} from '@tirapro/types';
import type {
  CreateRuleInput,
  RuleAction,
  RuleCondition,
  TriggerConfig,
  UpdateRuleInput,
} from '@tirapro/shared';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Quy tắc với `conditions`/`actions`/`triggerConfig` đã gán kiểu (BE đã kiểm bằng zod khi lưu). */
export interface AutomationRule extends Omit<
  AutomationRuleDto,
  'conditions' | 'actions' | 'triggerConfig'
> {
  conditions: RuleCondition[];
  actions: RuleAction[];
  triggerConfig: TriggerConfig;
}

/** `all` = mọi quy tắc của workspace (cần quyền cấp workspace); mã dự án = quy tắc của dự án đó + quy tắc cả workspace. */
export const ALL_RULES = 'all';

export function useRules(scope: string | undefined) {
  return useQuery({
    queryKey: keys.automation.rules(scope ?? ''),
    queryFn: scope
      ? async () =>
          (
            await api.get<AutomationRule[]>('/automation/rules', {
              params: scope === ALL_RULES ? undefined : { projectId: scope },
            })
          ).data
      : skipToken,
  });
}

function useInvalidateRules() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: keys.automation.rulesRoot });
}

export function useCreateRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (input: CreateRuleInput) =>
      api.post<AutomationRule>('/automation/rules', input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateRuleInput & { id: string }) =>
      api.patch<AutomationRule>(`/automation/rules/${id}`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/automation/rules/${id}`).then(() => undefined),
    onSuccess: invalidate,
  });
}

export function useRuleRuns(ruleId: string | undefined) {
  return useQuery({
    queryKey: keys.automation.ruleRuns(ruleId ?? ''),
    queryFn: ruleId
      ? async () => (await api.get<AutomationRunDto[]>(`/automation/rules/${ruleId}/runs`)).data
      : skipToken,
  });
}

/** Chạy thử trên một công việc: chỉ trả log, BE không áp dụng gì. */
export function useTestRule(ruleId: string) {
  return useMutation({
    mutationFn: (issueKey: string) =>
      api
        .post<AutomationRuleTestResultDto>(`/automation/rules/${ruleId}/test`, { issueKey })
        .then((r) => r.data),
  });
}

/* ------------------------------ Nhãn hiển thị ----------------------------- */

export const TRIGGER_LABELS: Record<RuleTrigger, string> = {
  ISSUE_CREATED: 'Khi công việc được tạo',
  ISSUE_TRANSITIONED: 'Khi đổi trạng thái',
  ISSUE_UPDATED: 'Khi công việc được sửa',
  COMMENT_ADDED: 'Khi có bình luận mới',
  SCHEDULED: 'Theo lịch (cron)',
};

export const FIELD_LABELS: Record<string, string> = {
  statusId: 'Trạng thái',
  priorityId: 'Mức ưu tiên',
  assigneeId: 'Người làm',
  reporterId: 'Người báo cáo',
  typeId: 'Loại công việc',
  sprintId: 'Sprint',
  resolutionId: 'Kết quả xử lý',
  storyPoints: 'Điểm ước lượng',
  summary: 'Tiêu đề',
  labelIds: 'Nhãn',
  dueDate: 'Hạn',
};

export const OP_LABELS: Record<string, string> = {
  eq: 'là',
  neq: 'không phải',
  in: 'là một trong',
  nin: 'không nằm trong',
  empty: 'đang trống',
  notEmpty: 'đã có giá trị',
  contains: 'chứa',
};

export const ACTION_LABELS: Record<RuleAction['type'], string> = {
  setField: 'Đặt giá trị trường',
  assign: 'Giao việc',
  transition: 'Chuyển trạng thái',
  addLabel: 'Gắn nhãn',
  removeLabel: 'Gỡ nhãn',
  addComment: 'Thêm bình luận',
  notify: 'Gửi thông báo',
  webhook: 'Gọi webhook',
  createSubtask: 'Tạo việc con',
};

/** Tóm tắt một quy tắc thành câu "Khi… nếu… thì…" cho danh sách. */
export function summarizeRule(
  r: Pick<AutomationRule, 'trigger' | 'triggerConfig' | 'conditions' | 'actions'>,
): string {
  const when =
    r.trigger === 'SCHEDULED' && r.triggerConfig.cron
      ? `Theo lịch ${r.triggerConfig.cron} (UTC)`
      : TRIGGER_LABELS[r.trigger];
  const iff = r.conditions.length ? ` · nếu ${r.conditions.length} điều kiện` : '';
  const then = r.actions.map((a) => ACTION_LABELS[a.type]).join(', ');
  return `${when}${iff} · thì ${then || '—'}`;
}
