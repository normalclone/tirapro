import { skipToken, useQuery } from '@tanstack/react-query';
import type { SprintDto } from '@tirapro/types';
import type {
  BurndownReport,
  VelocityReport,
  CfdReport,
  CreatedResolvedReport,
} from '@tirapro/shared';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

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

export function useProjectReport(projectId?: string) {
  return useQuery({
    queryKey: keys.reports.project(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<ProjectReport>(`/reports/project?projectId=${projectId}`)).data
      : skipToken,
    staleTime: 30_000,
  });
}

export function useProjectSprints(projectId?: string) {
  return useQuery({
    queryKey: keys.reports.sprints(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<SprintDto[]>(`/sprints?projectId=${projectId}`)).data
      : skipToken,
  });
}

export function useBurndown(sprintId?: string, projectId?: string) {
  return useQuery({
    // Sprint đã xác định dự án nên key không cần projectId.
    queryKey: keys.reports.burndown(sprintId ?? ''),
    queryFn:
      sprintId && projectId
        ? async () =>
            (
              await api.get<BurndownReport>(
                `/reports/burndown?sprintId=${sprintId}&projectId=${projectId}`,
              )
            ).data
        : skipToken,
  });
}

export function useVelocity(projectId?: string) {
  return useQuery({
    queryKey: keys.reports.velocity(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          (await api.get<VelocityReport>(`/reports/velocity?projectId=${projectId}&limit=8`)).data
      : skipToken,
  });
}

export function useCfd(projectId?: string) {
  return useQuery({
    queryKey: keys.reports.cfd(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<CfdReport>(`/reports/cfd?projectId=${projectId}`)).data
      : skipToken,
  });
}

export function useCreatedResolved(projectId?: string) {
  return useQuery({
    queryKey: keys.reports.createdResolved(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          (await api.get<CreatedResolvedReport>(`/reports/created-resolved?projectId=${projectId}`))
            .data
      : skipToken,
  });
}
