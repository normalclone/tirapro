import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DependencyType } from '@tirapro/types';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

// Loại phụ thuộc giữa hai công việc — enum lấy từ @tirapro/types (sinh từ Prisma).
export { DependencyType };

/** Nhãn tiếng Việt gọn cho từng loại phụ thuộc, dùng ở danh sách + ô chọn. */
export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: 'Xong mới bắt đầu',
  SS: 'Cùng bắt đầu',
  FF: 'Cùng kết thúc',
  SF: 'Bắt đầu mới được kết thúc',
};

/** Câu giải nghĩa đầy đủ cho tooltip — người mới đọc là hiểu ngay. */
export const DEPENDENCY_TYPE_HINTS: Record<DependencyType, string> = {
  FS: 'Việc trước phải xong thì việc sau mới được bắt đầu. Đây là kiểu hay dùng nhất.',
  SS: 'Hai việc bắt đầu cùng lúc: việc trước bắt đầu thì việc sau mới được bắt đầu.',
  FF: 'Hai việc kết thúc cùng lúc: việc trước xong thì việc sau mới được xong.',
  SF: 'Việc trước phải bắt đầu thì việc sau mới được kết thúc. Kiểu này hiếm dùng.',
};

export const DEPENDENCY_TYPES: DependencyType[] = [
  DependencyType.FS,
  DependencyType.SS,
  DependencyType.FF,
  DependencyType.SF,
];

export interface IssueRef {
  id: string;
  key: string;
  summary: string;
}

export interface DependencyDto {
  id: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
  createdAt: string;
  predecessor: IssueRef;
  successor: IssueRef;
}

export interface MilestoneDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  dueDate: string;
  completedAt: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BaselineSummaryDto {
  id: string;
  projectId: string;
  name: string;
  capturedAt: string;
  createdById: string | null;
  itemCount: number;
}

export interface BaselineItemDto {
  issueId: string;
  issueKey: string;
  summary: string;
  startDate: string | null;
  dueDate: string | null;
}

export interface BaselineDto extends BaselineSummaryDto {
  items: BaselineItemDto[];
}

export interface ScheduleItemDto {
  id: string;
  key: string;
  summary: string;
  startDate: string | null;
  dueDate: string | null;
  durationDays: number;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  slackDays: number;
  isCritical: boolean;
}

export interface ScheduleDto {
  projectStart: string | null;
  projectFinish: string | null;
  durationDays: number;
  criticalCount: number;
  dependencyCount: number;
  skippedCount: number;
  items: ScheduleItemDto[];
}

// ───────────────────────── phụ thuộc ─────────────────────────

export function useDependencies(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.planning.dependencies(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<DependencyDto[]>(`/planning/${projectId}/dependencies`)).data
      : skipToken,
  });
}

/** Đổi phụ thuộc là đường găng đổi theo → nạp lại luôn lịch trình. */
function useInvalidateSchedule(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.planning.dependencies(projectId) });
    void qc.invalidateQueries({ queryKey: keys.planning.schedule(projectId) });
  };
}

export function useCreateDependency(projectId: string) {
  const invalidate = useInvalidateSchedule(projectId);
  return useMutation({
    mutationFn: (input: {
      predecessorId: string;
      successorId: string;
      type?: DependencyType;
      lagDays?: number;
    }) => api.post<DependencyDto>(`/planning/${projectId}/dependencies`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteDependency(projectId: string) {
  const invalidate = useInvalidateSchedule(projectId);
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<Ack>(`/planning/${projectId}/dependencies/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

// ───────────────────────── cột mốc ─────────────────────────

export function useMilestones(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.planning.milestones(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<MilestoneDto[]>(`/planning/${projectId}/milestones`)).data
      : skipToken,
  });
}

export interface MilestoneInput {
  name?: string;
  dueDate?: string;
  description?: string | null;
  color?: string | null;
  completedAt?: string | null;
}

export function useCreateMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MilestoneInput) =>
      api.post<MilestoneDto>(`/planning/${projectId}/milestones`, input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.planning.milestones(projectId) }),
  });
}

export function useUpdateMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: MilestoneInput & { id: string }) =>
      api.put<MilestoneDto>(`/planning/${projectId}/milestones/${id}`, input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.planning.milestones(projectId) }),
  });
}

export function useDeleteMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<Ack>(`/planning/${projectId}/milestones/${id}`).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.planning.milestones(projectId) }),
  });
}

// ───────────────────────── kế hoạch gốc ─────────────────────────

export function useBaselines(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.planning.baselines(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<BaselineSummaryDto[]>(`/planning/${projectId}/baselines`)).data
      : skipToken,
  });
}

export function useBaseline(projectId: string | undefined, baselineId: string | undefined) {
  return useQuery({
    queryKey: keys.planning.baseline(projectId ?? '', baselineId ?? ''),
    queryFn:
      projectId && baselineId
        ? async () =>
            (await api.get<BaselineDto>(`/planning/${projectId}/baselines/${baselineId}`)).data
        : skipToken,
  });
}

export function useCreateBaseline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      api.post<BaselineDto>(`/planning/${projectId}/baselines`, input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.planning.baselines(projectId) }),
  });
}

// ───────────────────────── lịch trình / đường găng ─────────────────────────

export function useSchedule(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.planning.schedule(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<ScheduleDto>(`/planning/${projectId}/schedule`)).data
      : skipToken,
  });
}
