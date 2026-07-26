import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse, StatusCategory } from '@tirapro/types';
import { api } from '@/lib/api';

export type ObjectiveStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';
export type KeyResultUnit = 'NUMBER' | 'PERCENT' | 'CURRENCY';

export interface GoalOwner {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

export interface KeyResultDto {
  id: string;
  name: string;
  unit: KeyResultUnit;
  startValue: number;
  targetValue: number;
  currentValue: number;
  /** % hoàn thành đã kẹp trong [0,100] — BE tính (current-start)/(target-start). */
  progress: number;
}

export interface GoalIssueDto {
  id: string;
  key: string;
  summary: string;
  typeName: string | null;
  typeColor: string | null;
  statusName: string | null;
  statusCategory: StatusCategory | null;
  statusColor: string | null;
}

export interface GoalDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  project: { id: string; key: string; name: string } | null;
  name: string;
  description: string | null;
  period: string;
  status: ObjectiveStatus;
  owner: GoalOwner | null;
  keyResults: KeyResultDto[];
  issues: GoalIssueDto[];
  issueCount: number;
  issueDoneCount: number;
  keyResultProgress: number | null;
  issueProgress: number | null;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface KeyResultInput {
  id?: string;
  name: string;
  unit?: KeyResultUnit;
  startValue?: number;
  targetValue: number;
  currentValue?: number;
}

export interface GoalInput {
  name?: string;
  description?: string | null;
  period?: string;
  status?: ObjectiveStatus;
  projectId?: string | null;
  ownerId?: string | null;
  keyResults?: KeyResultInput[];
}

export interface GoalFilter {
  period?: string;
  projectId?: string;
  status?: ObjectiveStatus | '';
}

/** Khoá cache: mọi truy vấn mục tiêu bắt đầu bằng ['goals'] → invalidate 1 lần là đủ. */
export const goalsRootKey = ['goals'] as const;
export const goalsKey = (filter: GoalFilter) => ['goals', filter] as const;
export const goalPeriodsKey = ['goal-periods'] as const;

function cleanParams(filter: GoalFilter): Record<string, string> {
  const p: Record<string, string> = {};
  if (filter.period) p.period = filter.period;
  if (filter.projectId) p.projectId = filter.projectId;
  if (filter.status) p.status = filter.status;
  return p;
}

/** Danh sách mục tiêu (kèm Key Result, issue gắn kèm và tiến độ đã tính sẵn). */
export function useGoals(filter: GoalFilter) {
  return useQuery({
    queryKey: goalsKey(filter),
    queryFn: async () => (await api.get<GoalDto[]>('/goals', { params: cleanParams(filter) })).data,
  });
}

/** Các kỳ đã có mục tiêu (mới nhất trước) — dựng bộ chọn kỳ. */
export function useGoalPeriods() {
  return useQuery({
    queryKey: goalPeriodsKey,
    queryFn: async () => (await api.get<string[]>('/goals/periods')).data,
  });
}

function useInvalidateGoals() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: goalsRootKey });
    void qc.invalidateQueries({ queryKey: goalPeriodsKey });
  };
}

export function useCreateGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: async (input: GoalInput) => (await api.post<GoalDto>('/goals', input)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: async ({ id, ...input }: GoalInput & { id: string }) =>
      (await api.put<GoalDto>(`/goals/${id}`, input)).data,
    onSuccess: invalidate,
  });
}

export function useDeleteGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/goals/${id}`)).data,
    onSuccess: invalidate,
  });
}

/** Áp một hàm biến đổi lên mọi cache ['goals', …] đang có (optimistic UI). */
function patchGoalCaches(
  qc: ReturnType<typeof useQueryClient>,
  goalId: string,
  patch: (goal: GoalDto) => GoalDto,
) {
  qc.setQueriesData<GoalDto[]>({ queryKey: goalsRootKey }, (old) =>
    old?.map((g) => (g.id === goalId ? patch(g) : g)),
  );
}

function recalcProgress(goal: GoalDto): GoalDto {
  const krProgress = goal.keyResults.length
    ? Math.round(goal.keyResults.reduce((s, kr) => s + kr.progress, 0) / goal.keyResults.length)
    : null;
  return { ...goal, keyResultProgress: krProgress, progress: krProgress ?? goal.issueProgress ?? 0 };
}

/**
 * Cập nhật Key Result (dùng cho ô sửa giá trị hiện tại inline).
 * Optimistic: thanh tiến độ nhảy ngay, lỗi thì trả lại giá trị cũ.
 */
export function useUpdateKeyResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId, keyResultId, ...input
    }: { goalId: string; keyResultId: string } & Partial<Omit<KeyResultInput, 'id'>>) =>
      (await api.put<GoalDto>(`/goals/${goalId}/key-results/${keyResultId}`, input)).data,
    onMutate: async ({ goalId, keyResultId, currentValue }) => {
      if (currentValue === undefined) return { previous: undefined };
      await qc.cancelQueries({ queryKey: goalsRootKey });
      const previous = qc.getQueriesData<GoalDto[]>({ queryKey: goalsRootKey });
      patchGoalCaches(qc, goalId, (g) =>
        recalcProgress({
          ...g,
          keyResults: g.keyResults.map((kr) => {
            if (kr.id !== keyResultId) return kr;
            const span = kr.targetValue - kr.startValue;
            const ratio = span === 0
              ? (currentValue >= kr.targetValue ? 1 : 0)
              : Math.min(1, Math.max(0, (currentValue - kr.startValue) / span));
            return { ...kr, currentValue, progress: Math.round(ratio * 100) };
          }),
        }),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: goalsRootKey }),
  });
}

export function useAddKeyResult() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: async ({ goalId, ...input }: { goalId: string } & KeyResultInput) =>
      (await api.post<GoalDto>(`/goals/${goalId}/key-results`, input)).data,
    onSuccess: invalidate,
  });
}

export function useDeleteKeyResult() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: async ({ goalId, keyResultId }: { goalId: string; keyResultId: string }) =>
      (await api.delete<GoalDto>(`/goals/${goalId}/key-results/${keyResultId}`)).data,
    onSuccess: invalidate,
  });
}

/** Gắn issue/epic vào mục tiêu. */
export function useAttachGoalIssues() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: async ({ goalId, issueIds }: { goalId: string; issueIds: string[] }) =>
      (await api.post<GoalDto>(`/goals/${goalId}/issues`, { issueIds })).data,
    onSuccess: invalidate,
  });
}

/** Gỡ issue khỏi mục tiêu. */
export function useDetachGoalIssues() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: async ({ goalId, issueIds }: { goalId: string; issueIds: string[] }) =>
      (await api.delete<GoalDto>(`/goals/${goalId}/issues`, { data: { issueIds } })).data,
    onSuccess: invalidate,
  });
}

export interface IssueSearchItem {
  id: string;
  key: string;
  summary: string;
}

/** Tìm issue để gắn vào mục tiêu (tối đa 20 kết quả). */
export function useIssueSearch(term: string, projectId?: string | null, enabled = true) {
  const q = term.trim();
  return useQuery({
    queryKey: ['goal-issue-search', q, projectId ?? ''] as const,
    queryFn: async () => {
      const params: Record<string, string> = { limit: '20' };
      if (q) params.search = q;
      if (projectId) params.projectId = projectId;
      const res = await api.get<ListResponse<IssueSearchItem>>('/issues', { params });
      return res.data.data;
    },
    enabled,
  });
}
