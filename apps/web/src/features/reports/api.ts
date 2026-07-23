import { useQuery } from '@tanstack/react-query';
import type { SprintDto } from '@tirapro/types';
import type {
  BurndownReport,
  VelocityReport,
  CfdReport,
  CreatedResolvedReport,
} from '@tirapro/shared';
import { api } from '@/lib/api';

/** Số liệu tổng hợp một dự án cho màn Reports — `GET /reports/project`. */
export interface ProjectReportTotals {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  overdue: number;
  unassigned: number;
  points: number;
}

/** Một lát cắt cho sơ đồ cột/tròn (theo trạng thái / loại / ưu tiên). */
export interface ReportSlice {
  name: string;
  color: string | null;
  count: number;
}

/** Khối lượng theo người phụ trách. `id === null` là hàng "Chưa gán". */
export interface ReportAssignee {
  id: string | null;
  name: string;
  total: number;
  inProgress: number;
  done: number;
  overdue: number;
  points: number;
}

export interface ProjectReport {
  totals: ProjectReportTotals;
  completionRate: number;
  highPriUnassigned: number;
  dueSoon: number;
  byStatus: ReportSlice[];
  byType: ReportSlice[];
  byPriority: ReportSlice[];
  byAssignee: ReportAssignee[];
}

export const projectReportKey = (projectId: string) => ['report', 'project', projectId] as const;
export const projectSprintsKey = (projectId: string) => ['report', 'sprints', projectId] as const;
export const burndownKey = (sprintId: string) => ['report', 'burndown', sprintId] as const;
export const velocityKey = (projectId: string) => ['report', 'velocity', projectId] as const;
export const cfdKey = (projectId: string) => ['report', 'cfd', projectId] as const;
export const createdResolvedKey = (projectId: string) =>
  ['report', 'created-resolved', projectId] as const;

export function useProjectReport(projectId?: string) {
  return useQuery({
    queryKey: projectReportKey(projectId ?? ''),
    queryFn: async () =>
      (await api.get<ProjectReport>(`/reports/project?projectId=${projectId}`)).data,
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useProjectSprints(projectId?: string) {
  return useQuery({
    queryKey: projectSprintsKey(projectId ?? ''),
    queryFn: async () => (await api.get<SprintDto[]>(`/sprints?projectId=${projectId}`)).data,
    enabled: !!projectId,
  });
}

export function useBurndown(sprintId?: string) {
  return useQuery({
    queryKey: burndownKey(sprintId ?? ''),
    queryFn: async () =>
      (await api.get<BurndownReport>(`/reports/burndown?sprintId=${sprintId}`)).data,
    enabled: !!sprintId,
  });
}

export function useVelocity(projectId?: string) {
  return useQuery({
    queryKey: velocityKey(projectId ?? ''),
    queryFn: async () =>
      (await api.get<VelocityReport>(`/reports/velocity?projectId=${projectId}&limit=8`)).data,
    enabled: !!projectId,
  });
}

export function useCfd(projectId?: string) {
  return useQuery({
    queryKey: cfdKey(projectId ?? ''),
    queryFn: async () => (await api.get<CfdReport>(`/reports/cfd?projectId=${projectId}`)).data,
    enabled: !!projectId,
  });
}

export function useCreatedResolved(projectId?: string) {
  return useQuery({
    queryKey: createdResolvedKey(projectId ?? ''),
    queryFn: async () =>
      (await api.get<CreatedResolvedReport>(`/reports/created-resolved?projectId=${projectId}`))
        .data,
    enabled: !!projectId,
  });
}
