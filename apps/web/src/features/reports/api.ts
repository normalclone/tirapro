import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto, ListResponse, SprintDto } from '@tirapro/types';
import type {
  BurndownReport,
  VelocityReport,
  CfdReport,
  CreatedResolvedReport,
  QaReportDto,
  SprintSummaryReport,
  ProjectHealthDto,
} from '@tirapro/shared';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { qaRange } from './qaFormat';

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
  /** Sức khoẻ tự tính + ghi đè của PM (L16). */
  health: ProjectHealthDto | null;
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

/**
 * Ghi đè / bỏ ghi đè sức khoẻ dự án (`PATCH /projects/:id/health`, cần `project:admin`). `health: null` = bỏ ghi đè.
 * Xong thì nạp lại mọi nơi hiện sức khoẻ: báo cáo dự án, Tổng quan admin, Danh mục.
 */
export function useSetProjectHealth(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { health: 'GREEN' | 'YELLOW' | 'RED' | null; note?: string }) =>
      api.patch<ProjectHealthDto>(`/projects/${projectId}/health`, v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.reports.project(projectId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard.workspaceOverview });
      void qc.invalidateQueries({ queryKey: keys.programs.rollup });
    },
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

/** Tổng kết một sprint (x/y điểm, việc chuyển tiếp, so velocity TB) — `GET /reports/sprint-summary`. */
export function useSprintSummary(sprintId?: string, projectId?: string) {
  return useQuery({
    queryKey: keys.reports.sprintSummary(sprintId ?? ''),
    queryFn:
      sprintId && projectId
        ? async () =>
            (
              await api.get<SprintSummaryReport>(
                `/reports/sprint-summary?sprintId=${sprintId}&projectId=${projectId}`,
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

/** Báo cáo chất lượng (QA) — mirror `QaReportDto` của máy chủ (`GET /reports/qa`). */
export type QaReport = QaReportDto;

export function useQaReport(projectId: string | undefined, days: number) {
  return useQuery({
    queryKey: keys.reports.qa(projectId ?? '', days),
    queryFn: projectId
      ? async () => {
          const { from, to } = qaRange(days);
          const qs = new URLSearchParams({ projectId, from, to });
          return (await api.get<QaReport>(`/reports/qa?${qs.toString()}`)).data;
        }
      : skipToken,
    // Đổi kỳ 7/30/90: giữ số cũ mờ đi trong lúc tải. CHỈ giữ khi cùng dự án — không hiện số của dự án khác.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[2] === (projectId ?? '') ? prev : undefined,
  });
}

/** Trần số việc gom khi xuất một sprint (sprint thật hiếm khi tới mức này). */
const SPRINT_EXPORT_CAP = 5000;

/**
 * Việc của MỘT sprint, lấy MỚI từ máy chủ (không đọc cache, không phụ thuộc danh sách dự án bị cắt ở 2000 việc).
 * `truncated` = còn việc chưa lấy vì chạm trần `cap`; nơi gọi phải báo người dùng thay vì xuất thiếu im lặng.
 */
export async function fetchSprintIssues(
  projectId: string,
  sprintId: string,
  cap = SPRINT_EXPORT_CAP,
): Promise<{ issues: IssueDto[]; truncated: boolean }> {
  const issues: IssueDto[] = [];
  let cursor: string | null = null;
  for (;;) {
    const qs = new URLSearchParams({ projectId, sprintId, limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const res: ListResponse<IssueDto> = (
      await api.get<ListResponse<IssueDto>>(`/issues?${qs.toString()}`)
    ).data;
    issues.push(...res.data);
    const info = res.pageInfo;
    const next = 'hasNextPage' in info && info.hasNextPage ? info.endCursor : null;
    if (!next || res.data.length === 0) return { issues, truncated: false };
    if (issues.length >= cap) return { issues, truncated: true };
    cursor = next;
  }
}
