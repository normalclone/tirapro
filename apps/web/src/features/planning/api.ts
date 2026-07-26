import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Loại phụ thuộc giữa hai công việc (mirror `DependencyType` của Prisma). */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

/** Nhãn tiếng Việt cho từng loại phụ thuộc, dùng chung ở form + tooltip. */
export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: 'Kết thúc → Bắt đầu',
  SS: 'Bắt đầu → Bắt đầu',
  FF: 'Kết thúc → Kết thúc',
  SF: 'Bắt đầu → Kết thúc',
};

export const DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

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

export const planningKeys = {
  dependencies: (projectId: string) => ['planning', 'dependencies', projectId] as const,
  milestones: (projectId: string) => ['planning', 'milestones', projectId] as const,
  baselines: (projectId: string) => ['planning', 'baselines', projectId] as const,
  baseline: (projectId: string, baselineId: string) => ['planning', 'baseline', projectId, baselineId] as const,
  schedule: (projectId: string) => ['planning', 'schedule', projectId] as const,
};

// ───────────────────────── phụ thuộc ─────────────────────────

export function useDependencies(projectId: string | undefined) {
  return useQuery({
    queryKey: planningKeys.dependencies(projectId ?? ''),
    queryFn: async () => (await api.get<DependencyDto[]>(`/planning/${projectId}/dependencies`)).data,
    enabled: !!projectId,
  });
}

/** Sau khi đổi phụ thuộc thì đường găng cũng đổi → nạp lại luôn lịch trình. */
function useInvalidateSchedule(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: planningKeys.dependencies(projectId) });
    void qc.invalidateQueries({ queryKey: planningKeys.schedule(projectId) });
  };
}

export function useCreateDependency(projectId: string) {
  const invalidate = useInvalidateSchedule(projectId);
  return useMutation({
    mutationFn: (input: { predecessorId: string; successorId: string; type?: DependencyType; lagDays?: number }) =>
      api.post<DependencyDto>(`/planning/${projectId}/dependencies`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteDependency(projectId: string) {
  const invalidate = useInvalidateSchedule(projectId);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/planning/${projectId}/dependencies/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

// ───────────────────────── cột mốc ─────────────────────────

export function useMilestones(projectId: string | undefined) {
  return useQuery({
    queryKey: planningKeys.milestones(projectId ?? ''),
    queryFn: async () => (await api.get<MilestoneDto[]>(`/planning/${projectId}/milestones`)).data,
    enabled: !!projectId,
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: planningKeys.milestones(projectId) }),
  });
}

export function useUpdateMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: MilestoneInput & { id: string }) =>
      api.put<MilestoneDto>(`/planning/${projectId}/milestones/${id}`, input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: planningKeys.milestones(projectId) }),
  });
}

export function useDeleteMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/planning/${projectId}/milestones/${id}`).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: planningKeys.milestones(projectId) }),
  });
}

// ───────────────────────── kế hoạch gốc ─────────────────────────

export function useBaselines(projectId: string | undefined) {
  return useQuery({
    queryKey: planningKeys.baselines(projectId ?? ''),
    queryFn: async () => (await api.get<BaselineSummaryDto[]>(`/planning/${projectId}/baselines`)).data,
    enabled: !!projectId,
  });
}

export function useBaseline(projectId: string | undefined, baselineId: string | undefined) {
  return useQuery({
    queryKey: planningKeys.baseline(projectId ?? '', baselineId ?? ''),
    queryFn: async () => (await api.get<BaselineDto>(`/planning/${projectId}/baselines/${baselineId}`)).data,
    enabled: !!projectId && !!baselineId,
  });
}

export function useCreateBaseline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      api.post<BaselineDto>(`/planning/${projectId}/baselines`, input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: planningKeys.baselines(projectId) }),
  });
}

// ───────────────────────── lịch trình / đường găng ─────────────────────────

export function useSchedule(projectId: string | undefined) {
  return useQuery({
    queryKey: planningKeys.schedule(projectId ?? ''),
    queryFn: async () => (await api.get<ScheduleDto>(`/planning/${projectId}/schedule`)).data,
    enabled: !!projectId,
  });
}
