import { useAuth } from '@/stores/auth';
import { useWorkspaceOverview } from '@/features/dashboard/api';
import { useCreatedResolved, useProjectReport } from '@/features/reports/api';
import { StatRow } from '@/components/ui/StatRow';
import {
  resolvedLast14Days,
  sourceFromProjectReport,
  STAT_METRIC_META,
  statCell,
  type StatMetric,
  type StatSource,
} from '../statMetrics';
import { cfgString } from '../widgetConfig';
import { queryWidgetState, type WidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

const METRICS = Object.keys(STAT_METRIC_META) as StatMetric[];
const isMetric = (v: unknown): v is StatMetric => METRICS.includes(v as StatMetric);

/** Một chỉ số (số cỡ vừa, kiểu `StatRow`; không còn số khổng lồ). Có `projectId` → số của dự án đó; không có → toàn workspace (cần quyền xem báo cáo). */
export function StatNumberWidget({ title, config }: WidgetProps) {
  const metric: StatMetric = isMetric(config.metric) ? config.metric : 'open';
  const projectId = cfgString(config, 'projectId');
  const canReport = useAuth((s) => s.can('report:view'));

  const overview = useWorkspaceOverview(!projectId && canReport);
  const report = useProjectReport(projectId);
  const resolved = useCreatedResolved(projectId && metric === 'done14' ? projectId : undefined);

  if (!projectId && !canReport) {
    return <WidgetFrame title={title} state="forbidden" forbiddenText="Cần quyền xem báo cáo" />;
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
  const meta = STAT_METRIC_META[metric];

  return (
    <WidgetFrame
      title={title}
      state={state}
      error={active.error}
      onRetry={() => void active.refetch()}
    >
      <StatRow
        cols="grid-cols-1"
        // Đã nằm trong khung ô: bỏ viền/bo của hàng chỉ số để không thành hộp trong hộp.
        className="rounded-none border-0"
        items={[{ ...cell, label: meta.label, value: cell?.value ?? '—', title: meta.hint }]}
      />
    </WidgetFrame>
  );
}
