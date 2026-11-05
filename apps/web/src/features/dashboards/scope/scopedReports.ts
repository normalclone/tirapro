import { skipToken, useQuery } from '@tanstack/react-query';
import type { QaReportDto } from '@tirapro/shared';
import { api } from '@/lib/api';
import type { LeadershipOverview, OrganizationOverview } from '@/features/dashboard/api';
import { qaRange } from '@/features/reports/qaFormat';
import { useQaReport } from '@/features/reports/api';
import type { ResolvedScope } from './widgetScope';

/** Trần máy chủ cho một yêu cầu phạm vi nhóm (khớp `MAX_SCOPE_PROJECTS` của API). */
const MAX_SCOPE_IDS = 200;

/**
 * `projectIds=a,b` — LUÔN có tham số khi có phạm vi, kể cả danh sách RỖNG (`projectIds=`): máy chủ hiểu "vắng tham số" là
 * "không thu hẹp (mọi dự án người xem thấy)" còn "rỗng" là "không dự án nào". Bỏ tham số khi rỗng sẽ làm ô của nhóm trống
 * hiện số của cả tổ chức.
 */
export function projectIdsParam(ids: readonly string[]): string {
  return `projectIds=${ids.map(encodeURIComponent).join(',')}`;
}

const withQuery = (path: string, parts: string[]) =>
  parts.length > 0 ? `${path}?${parts.join('&')}` : path;

/** `ids = null` → không thu hẹp (toàn tổ chức). `byAssignee` chỉ bật cho ô "theo người". */
export function overviewPath(ids: readonly string[] | null, byAssignee = false): string {
  return withQuery('/reports/overview', [
    ...(ids ? [projectIdsParam(ids)] : []),
    ...(byAssignee ? ['byAssignee=1'] : []),
  ]);
}

export function leadershipPath(ids: readonly string[] | null): string {
  return withQuery('/reports/leadership', ids ? [projectIdsParam(ids)] : []);
}

export function qaProjectsPath(ids: readonly string[], days: number, now?: Date): string {
  const { from, to } = qaRange(days, now);
  return `/reports/qa/projects?${projectIdsParam(ids)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

const idsKey = (ids: readonly string[] | null) => (ids ? ids.join(',') : '*');

/** Tổng quan (gộp) theo phạm vi: `ids = null` toàn tổ chức; mảng (kể cả rỗng) → thu hẹp. */
export function useScopedOverview(
  ids: readonly string[] | null,
  enabled: boolean,
  byAssignee = false,
) {
  return useQuery({
    queryKey: ['dashboards', 'scoped', 'overview', idsKey(ids), byAssignee] as const,
    queryFn: enabled
      ? async () => (await api.get<OrganizationOverview>(overviewPath(ids, byAssignee))).data
      : skipToken,
    staleTime: 30_000,
  });
}

/** Ba thẻ lãnh đạo theo phạm vi (thẻ người quá tải chỉ có khi `ids = null`). */
export function useScopedLeadership(ids: readonly string[] | null, enabled: boolean) {
  return useQuery({
    queryKey: ['dashboards', 'scoped', 'leadership', idsKey(ids)] as const,
    queryFn: enabled
      ? async () => (await api.get<LeadershipOverview>(leadershipPath(ids))).data
      : skipToken,
    staleTime: 30_000,
  });
}

/** Báo cáo QA nhiều dự án (`/reports/qa/projects`), `ids` có thể rỗng. */
function useQaForProjects(ids: readonly string[] | undefined, days: number) {
  return useQuery({
    queryKey: ['dashboards', 'scoped', 'qa', ids ? idsKey(ids) : '-', days] as const,
    queryFn: ids
      ? async () => (await api.get<QaReportDto>(qaProjectsPath(ids, days))).data
      : skipToken,
    staleTime: 30_000,
  });
}

/** Kết quả đã chuẩn hoá của một nguồn dữ liệu QA (ba đường lấy khác nhau, một hình dạng cho ô). */
export interface ScopedQa {
  data: QaReportDto | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * Báo cáo QA theo nguồn số liệu của ô: một dự án → `/reports/qa?projectId`; nhóm → `/reports/qa/projects`; toàn tổ chức →
 * `/reports/qa/projects` với mọi dự án đang hoạt động người xem thấy (lấy từ tổng quan, tối đa `MAX_SCOPE_IDS`).
 */
export function useScopedQa(scope: ResolvedScope, enabled: boolean, days = 30): ScopedQa {
  const single = useQaReport(
    enabled && scope.kind === 'project' ? scope.projectId : undefined,
    days,
  );
  const orgOverview = useScopedOverview(null, enabled && scope.kind === 'org');
  const ids =
    !enabled || scope.kind === 'project'
      ? undefined
      : scope.kind === 'projects'
        ? scope.ids
        : orgOverview.data?.projects.map((p) => p.id).slice(0, MAX_SCOPE_IDS);
  const multi = useQaForProjects(ids, days);
  if (scope.kind === 'project') return single;
  // Toàn tổ chức còn chờ danh sách dự án: trạng thái chờ/lỗi của chính yêu cầu danh sách đó.
  if (scope.kind === 'org' && !orgOverview.data) {
    return {
      data: undefined,
      isError: orgOverview.isError,
      error: orgOverview.error,
      refetch: orgOverview.refetch,
    };
  }
  return multi;
}
