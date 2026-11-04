import { scopeJql, type CustomDashboardDto, type DashboardDataScopeValue } from '@tirapro/shared';
import { cfgString } from '../widgetConfig';

/** Phần của DTO dashboard mà ô cần để biết mình đọc số liệu của dự án nào. */
export interface DashboardScopeInfo {
  dataScope: DashboardDataScopeValue;
  /** Dự án trong phạm vi mà NGƯỜI XEM thấy; `null` = toàn tổ chức (không lọc). */
  scopeProjects: Array<{ id: string; key: string; name: string }> | null;
  programName: string | null;
}

/** Ngữ cảnh một ô: dashboard + máy chủ đã giải sẵn danh sách dự án cho ô này (`projectIds`, `inherits`). */
export interface WidgetScopeInfo {
  dashboard: DashboardScopeInfo;
  inherits: boolean;
  /** `null` = toàn tổ chức (mọi dự án người xem thấy). `[]` = KHÔNG dự án nào (không bao giờ hiểu là "tất cả"). */
  projectIds: string[] | null;
}

/** Nguồn số liệu đã giải của một ô. */
export type ResolvedScope =
  | { kind: 'org' }
  | { kind: 'project'; projectId: string }
  | { kind: 'projects'; ids: string[] };

export function scopeInfoOf(
  d: Pick<CustomDashboardDto, 'dataScope' | 'scopeProjects' | 'scopeProgramName'>,
): DashboardScopeInfo {
  return {
    dataScope: d.dataScope,
    scopeProjects: d.scopeProjects,
    programName: d.scopeProgramName,
  };
}

/**
 * Ô đọc số liệu của đâu: dự án tự đặt trong cấu hình thắng (cách cũ); không thì theo danh sách máy chủ giải cho ô. Không có
 * ngữ cảnh dashboard (bản xem trước, trang khác) → toàn tổ chức như trước khi có phạm vi dữ liệu.
 * Phạm vi "một dự án" mà người xem thấy dự án đó → `project` (dùng báo cáo đầy đủ của dự án); không thấy → `projects: []`.
 */
export function resolveScope(
  info: WidgetScopeInfo | null,
  config: Record<string, unknown>,
): ResolvedScope {
  const own = cfgString(config, 'projectId');
  if (own) return { kind: 'project', projectId: own };
  if (!info || info.projectIds === null) return { kind: 'org' };
  if (info.dashboard.dataScope === 'PROJECT' && info.projectIds.length === 1) {
    return { kind: 'project', projectId: info.projectIds[0]! };
  }
  return { kind: 'projects', ids: info.projectIds };
}

/** `projectIds` của báo cáo gộp: `null` = không lọc (toàn tổ chức); `project` = đúng dự án đó. */
export function aggregateIds(scope: ResolvedScope): string[] | null {
  if (scope.kind === 'org') return null;
  return scope.kind === 'project' ? [scope.projectId] : scope.ids;
}

/**
 * JQL của ô danh sách theo phạm vi: toàn tổ chức → nguyên văn; còn lại gắn `project IN (…)` từ dự án người xem thấy.
 * `null` = không có dự án nào trong phạm vi → ô phải hiện trống, KHÔNG được chạy JQL không giới hạn.
 */
export function issueListJql(
  jql: string,
  scope: ResolvedScope,
  info: WidgetScopeInfo | null,
): string | null {
  if (scope.kind === 'org') return jql;
  const ids = new Set(aggregateIds(scope) ?? []);
  const keys = (info?.dashboard.scopeProjects ?? []).filter((p) => ids.has(p.id)).map((p) => p.key);
  return scopeJql(jql, keys);
}

/** Nhãn ngắn "ô này lấy số liệu của đâu" hiện ở đầu ô. `explicitKey` = mã dự án khi ô tự đặt dự án. */
export function scopeLabel(
  info: WidgetScopeInfo | null,
  scope: ResolvedScope,
  explicitKey?: string,
): string | null {
  if (!info) return null;
  if (!info.inherits) return explicitKey ? `Dự án ${explicitKey} (riêng)` : 'Dự án riêng';
  const { dataScope, scopeProjects, programName } = info.dashboard;
  if (dataScope === 'ORG') return 'Toàn tổ chức';
  const count = scope.kind === 'projects' ? scope.ids.length : 1;
  if (dataScope === 'PROJECT') {
    const p = scopeProjects?.[0];
    return p ? `Dự án ${p.key}` : 'Dự án bạn không xem được';
  }
  if (!programName) return 'Nhóm đã bị xoá';
  return `Nhóm ${programName} · ${count} dự án`;
}

/** Nhãn đầy đủ của phạm vi dữ liệu cho cài đặt dashboard / tiêu đề trang. */
export function dataScopeSummary(
  d: Pick<CustomDashboardDto, 'dataScope' | 'scopeProjects' | 'scopeProgramName'>,
): string {
  if (d.dataScope === 'ORG') return 'Toàn tổ chức';
  if (d.dataScope === 'PROJECT') {
    const p = d.scopeProjects?.[0];
    return p ? `Dự án ${p.key} · ${p.name}` : 'Dự án bạn không xem được';
  }
  if (!d.scopeProgramName) return 'Nhóm đã bị xoá — chọn lại';
  const n = d.scopeProjects?.length ?? 0;
  return `Nhóm ${d.scopeProgramName} · ${n} dự án bạn xem được`;
}

/**
 * Ngữ cảnh một ô từ dashboard. Ưu tiên danh sách máy chủ đã giải riêng cho ô (`server`); không có (chế độ soạn) thì tự dựng
 * từ `scopeProjects` đã lưu: ô tự đặt dự án → [dự án đó], ô kế thừa → danh sách của bảng. Không có dashboard → `null`.
 */
export function widgetInfoOf(
  dashboard: DashboardScopeInfo | null,
  config: Record<string, unknown>,
  server?: { inherits?: boolean; projectIds?: string[] | null },
): WidgetScopeInfo | null {
  if (!dashboard) return null;
  const own = cfgString(config, 'projectId');
  const inherits = server?.inherits ?? !own;
  const projectIds =
    server && server.projectIds !== undefined
      ? server.projectIds
      : own
        ? [own]
        : dashboard.scopeProjects
          ? dashboard.scopeProjects.map((p) => p.id)
          : null;
  return { dashboard, inherits, projectIds };
}
