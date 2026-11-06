import { useAuth } from '@/stores/auth';
import { useCreatedResolved, useProjectReport } from '@/features/reports/api';
import { formatPercent } from '@/features/reports/qaFormat';
import { StatRow } from '@/components/ui/StatRow';
import {
  resolvedLast14Days,
  sourceFromProjectReport,
  STAT_METRIC_META,
  statCell,
  type StatMetric,
  type StatSource,
} from '../statMetrics';
import { useWidgetScope } from '../scope/ScopeContext';
import { aggregateIds } from '../scope/widgetScope';
import { useScopedOverview, useScopedQa } from '../scope/scopedReports';
import { queryWidgetState, type WidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

const METRICS = Object.keys(STAT_METRIC_META) as StatMetric[];
const isMetric = (v: unknown): v is StatMetric => METRICS.includes(v as StatMetric);

/**
 * Một chỉ số (số cỡ vừa, kiểu `StatRow`). Nguồn theo phạm vi của ô: một dự án → báo cáo dự án; nhóm dự án → tổng quan thu
 * hẹp vào các dự án người xem thấy; toàn tổ chức → tổng quan chung (cần quyền xem báo cáo cấp tổ chức). "Tỉ lệ mở lại" lấy từ báo cáo QA.
 */
export function StatNumberWidget({ title, config }: WidgetProps) {
  const metric: StatMetric = isMetric(config.metric) ? config.metric : 'open';
  const scope = useWidgetScope(config);
  const projectId = scope.kind === 'project' ? scope.projectId : undefined;
  const isQa = metric === 'reopenRate';
  const canReport = useAuth((s) => s.can('report:view'));
  // Toàn tổ chức cần quyền báo cáo cấp tổ chức; nhóm dự án: máy chủ cho qua nếu có quyền trong từng dự án (403 → ô báo thiếu quyền).
  const needsOrgReport = scope.kind !== 'project';
  const blocked = scope.kind === 'org' && !canReport;

  const overview = useScopedOverview(aggregateIds(scope), needsOrgReport && !blocked && !isQa);
  const report = useProjectReport(isQa ? undefined : projectId);
  const resolved = useCreatedResolved(projectId && metric === 'done14' ? projectId : undefined);
  const qa = useScopedQa(scope, isQa && !blocked);

  if (blocked) {
    return <WidgetFrame title={title} state="forbidden" forbiddenText="Cần quyền xem báo cáo" />;
  }

  const meta = STAT_METRIC_META[metric];
  if (isQa) {
    const state = queryWidgetState({ data: qa.data, isError: qa.isError, error: qa.error });
    return (
      <WidgetFrame title={title} state={state} error={qa.error} onRetry={() => void qa.refetch()}>
        <StatRow
          cols="grid-cols-1"
          bare
          items={[
            {
              label: meta.label,
              value: qa.data ? formatPercent(qa.data.reopenRate) : '—',
              title: meta.hint,
            },
          ]}
        />
      </WidgetFrame>
    );
  }

  const active = projectId ? report : overview;
  let src: StatSource | undefined;
  if (projectId) {
    const r14 = resolved.data ? resolvedLast14Days(resolved.data.series) : null;
    src = report.data ? sourceFromProjectReport(report.data, r14) : undefined;
  } else if (overview.data) {
    const o = overview.data;
    // Xu hướng theo 8 khối 7 ngày, 2 khối cuối = đúng 14 ngày gần nhất.
    src = {
      totals: o.totals,
      projectCount: o.projectCount,
      resolved14: o.trend.slice(-2).reduce((sum, p) => sum + p.resolved, 0),
    };
  }
  // `done14` của dự án còn chờ chuỗi theo ngày → vẫn "đang tải" (không hiện "—" rồi nhảy sang số).
  const waitingResolved = !!projectId && metric === 'done14' && !resolved.data && !resolved.isError;
  const state: WidgetState =
    src && !waitingResolved
      ? 'ready'
      : queryWidgetState({ data: undefined, isError: active.isError, error: active.error });
  const cell = src ? statCell(metric, src) : null;

  return (
    <WidgetFrame
      title={title}
      state={state}
      error={active.error}
      onRetry={() => void active.refetch()}
    >
      <StatRow
        cols="grid-cols-1"
        bare // đã nằm trong khung ô: không viền/đệm thứ hai
        items={[{ ...cell, label: meta.label, value: cell?.value ?? '—', title: meta.hint }]}
      />
    </WidgetFrame>
  );
}
