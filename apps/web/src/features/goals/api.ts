import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KeyResultSource,
  KeyResultUnit,
  ListResponse,
  ObjectiveStatus,
  StatusCategory,
} from '@tirapro/types';
import type { KrSourceConfig } from './krSource';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

// Enum lấy từ @tirapro/types (sinh từ Prisma); re-export để các màn Mục tiêu import một chỗ.
export type { KeyResultSource, KeyResultUnit, ObjectiveStatus };

interface GoalOwner {
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
  /** KR tự đo (`source` != MANUAL): số đo trực tiếp lúc đọc; đo lỗi thì giữ số cũ + `measureError`. */
  currentValue: number;
  source: KeyResultSource;
  sourceConfig: KrSourceConfig;
  /** Thời điểm đo (ISO) — null với KR nhập tay. */
  measuredAt: string | null;
  /** Lý do không đo được (JQL sai, dự án không còn…) — null nếu ổn. */
  measureError: string | null;
  /** Nhãn đơn vị nối sau số ("4 bug"); bỏ qua với PERCENT. */
  unitLabel: string | null;
  /** Số check-in tay đã ghi và lần gần nhất (ISO) — null nếu chưa có. */
  checkInCount: number;
  lastCheckInAt: string | null;
  /** % hoàn thành đã kẹp trong [0,100] — BE tính (current-start)/(target-start). */
  progress: number;
}

interface GoalIssueDto {
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
  /** OCC: số hiện tại lúc mở form — BE trả 409 nếu người khác vừa đổi. */
  expectedCurrentValue?: number;
  source?: KeyResultSource;
  sourceConfig?: KrSourceConfig;
  unitLabel?: string | null;
}

/** GET /goals/:id/progress-history — lịch sử tiến độ theo ngày (L29). */
export interface GoalProgressHistory {
  period: string;
  /** YYYY-MM-DD */
  from: string;
  to: string;
  keyResults: Array<{
    id: string;
    name: string;
    unit: KeyResultUnit;
    unitLabel: string | null;
    source: KeyResultSource;
    points: Array<{ date: string; value: number; progress: number; auto: boolean }>;
    /** Có giá trị khi người xem không được xem lịch sử của KR này (dự án riêng tư). */
    scopeNote: string | null;
  }>;
  /** Trung bình tiến độ các KR tại từng ngày. */
  objective: Array<{ date: string; progress: number }>;
  /** Mốc kỳ vọng theo thời gian của quý; null với kỳ tự do. */
  expected: Array<{ date: string; progress: number }> | null;
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
    queryKey: keys.goals.list(filter),
    queryFn: async () => (await api.get<GoalDto[]>('/goals', { params: cleanParams(filter) })).data,
  });
}

/** Các kỳ đã có mục tiêu (mới nhất trước) — dựng bộ chọn kỳ. */
export function useGoalPeriods() {
  return useQuery({
    queryKey: keys.goals.periods,
    queryFn: async () => (await api.get<string[]>('/goals/periods')).data,
  });
}

function useInvalidateGoals() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.goals.all });
    void qc.invalidateQueries({ queryKey: keys.goals.periods });
    void qc.invalidateQueries({ queryKey: keys.goals.historyAll });
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
    mutationFn: async (id: string) => (await api.delete<Ack>(`/goals/${id}`)).data,
    onSuccess: invalidate,
  });
}

/** Áp một hàm biến đổi lên mọi cache ['goals', …] đang có (optimistic UI). */
function patchGoalCaches(
  qc: ReturnType<typeof useQueryClient>,
  goalId: string,
  patch: (goal: GoalDto) => GoalDto,
) {
  qc.setQueriesData<GoalDto[]>({ queryKey: keys.goals.all }, (old) =>
    old?.map((g) => (g.id === goalId ? patch(g) : g)),
  );
}

function recalcProgress(goal: GoalDto): GoalDto {
  const krProgress = goal.keyResults.length
    ? Math.round(goal.keyResults.reduce((s, kr) => s + kr.progress, 0) / goal.keyResults.length)
    : null;
  return {
    ...goal,
    keyResultProgress: krProgress,
    progress: krProgress ?? goal.issueProgress ?? 0,
  };
}

/**
 * Cập nhật Key Result (dùng cho ô sửa giá trị hiện tại inline).
 * Optimistic: thanh tiến độ nhảy ngay, lỗi thì trả lại giá trị cũ.
 */
export function useUpdateKeyResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId,
      keyResultId,
      ...input
    }: { goalId: string; keyResultId: string } & Partial<Omit<KeyResultInput, 'id'>>) =>
      (await api.put<GoalDto>(`/goals/${goalId}/key-results/${keyResultId}`, input)).data,
    onMutate: async ({ goalId, keyResultId, currentValue }) => {
      if (currentValue === undefined) return { previous: undefined };
      await qc.cancelQueries({ queryKey: keys.goals.all });
      const previous = qc.getQueriesData<GoalDto[]>({ queryKey: keys.goals.all });
      patchGoalCaches(qc, goalId, (g) => withCurrentValue(g, keyResultId, currentValue));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.goals.all });
      // Sửa số hiện tại nay cũng ghi một dòng lịch sử check-in.
      void qc.invalidateQueries({ queryKey: keys.goals.checkInsAll });
      void qc.invalidateQueries({ queryKey: keys.goals.historyAll });
    },
  });
}

/** Đặt `currentValue` của một KR và tính lại % (khớp công thức BE) — dùng cho optimistic UI. */
function withCurrentValue(goal: GoalDto, keyResultId: string, currentValue: number): GoalDto {
  return recalcProgress({
    ...goal,
    keyResults: goal.keyResults.map((kr) => {
      if (kr.id !== keyResultId) return kr;
      const span = kr.targetValue - kr.startValue;
      const ratio =
        span === 0
          ? currentValue >= kr.targetValue
            ? 1
            : 0
          : Math.min(1, Math.max(0, (currentValue - kr.startValue) / span));
      return { ...kr, currentValue, progress: Math.round(ratio * 100) };
    }),
  });
}

export interface CheckInDto {
  id: string;
  value: number;
  previousValue: number | null;
  note: string | null;
  author: { id: string; displayName: string } | null;
  createdAt: string;
}

/** Lịch sử check-in của một KR, mới nhất trước (`enabled`: chỉ tải khi mở danh sách). */
export function useCheckIns(goalId: string, keyResultId: string, limit: number, enabled: boolean) {
  return useQuery({
    queryKey: keys.goals.checkIns(goalId, keyResultId, limit),
    queryFn: enabled
      ? async () =>
          (
            await api.get<CheckInDto[]>(`/goals/${goalId}/key-results/${keyResultId}/check-ins`, {
              params: { limit },
            })
          ).data
      : skipToken,
  });
}

/** Lịch sử tiến độ theo ngày của một mục tiêu (`enabled`: chỉ tải khi mở biểu đồ). */
export function useProgressHistory(goalId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.goals.history(goalId),
    queryFn: enabled
      ? async () => (await api.get<GoalProgressHistory>(`/goals/${goalId}/progress-history`)).data
      : skipToken,
  });
}

/** Check-in tay: ghi lịch sử + cập nhật giá trị hiện tại; thanh tiến độ nhảy ngay, lỗi thì trả lại số cũ. */
export function useAddCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId,
      keyResultId,
      ...input
    }: {
      goalId: string;
      keyResultId: string;
      value: number;
      /** OCC: số hiện tại người dùng đã thấy — lệch số trong DB thì BE trả 409. */
      expectedValue?: number;
      note?: string;
    }) =>
      (await api.post<GoalDto>(`/goals/${goalId}/key-results/${keyResultId}/check-ins`, input))
        .data,
    onMutate: async ({ goalId, keyResultId, value }) => {
      await qc.cancelQueries({ queryKey: keys.goals.all });
      const previous = qc.getQueriesData<GoalDto[]>({ queryKey: keys.goals.all });
      patchGoalCaches(qc, goalId, (g) => withCurrentValue(g, keyResultId, value));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.goals.all });
      void qc.invalidateQueries({ queryKey: keys.goals.checkInsAll });
      void qc.invalidateQueries({ queryKey: keys.goals.historyAll });
    },
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
    queryKey: keys.goals.issueSearch(q, projectId ?? ''),
    queryFn: enabled
      ? async () => {
          const params: Record<string, string> = { limit: '20' };
          if (q) params.search = q;
          if (projectId) params.projectId = projectId;
          const res = await api.get<ListResponse<IssueSearchItem>>('/issues', { params });
          return res.data.data;
        }
      : skipToken,
  });
}
