import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/stores/auth';
import { useCreatedResolved } from '@/features/reports/api';
import { AXIS_PROPS, LEGEND_STYLE, TOOLTIP_STYLE } from '@/features/reports/charts';
import { CHART_MARGIN, yAxisWidth } from '@/lib/chartAxis';
import { fmtDayMonth } from '@/lib/dateFormat';
import { useWidgetScope } from '../scope/ScopeContext';
import { aggregateIds } from '../scope/widgetScope';
import { useScopedOverview } from '../scope/scopedReports';
import { queryWidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

interface Point {
  label: string;
  created: number;
  resolved: number;
}

/** Tạo mới vs Đã xử lý: theo ngày (một dự án) hoặc theo tuần (toàn tổ chức). */
export function CreatedResolvedWidget({ title, config }: WidgetProps) {
  const scope = useWidgetScope(config);
  const projectId = scope.kind === 'project' ? scope.projectId : undefined;
  const canReport = useAuth((s) => s.can('report:view'));
  // Toàn tổ chức cần quyền báo cáo cấp tổ chức; nhóm dự án: máy chủ cho qua nếu có quyền trong từng dự án (403 → ô báo thiếu quyền).
  const blocked = scope.kind === 'org' && !canReport;
  const daily = useCreatedResolved(projectId);
  const weekly = useScopedOverview(aggregateIds(scope), !projectId && !blocked);

  if (blocked) {
    return <WidgetFrame title={title} state="forbidden" forbiddenText="Cần quyền xem báo cáo" />;
  }

  const q = projectId ? daily : weekly;
  let points: Point[] | undefined;
  if (projectId && daily.data) {
    points = daily.data.series.map((p) => ({ ...p, label: fmtDayMonth(p.date) }));
  } else if (!projectId && weekly.data) {
    points = weekly.data.trend;
  }
  const state = queryWidgetState(
    { data: points, isError: q.isError, error: q.error },
    (d) => d.length === 0 || d.every((p) => p.created === 0 && p.resolved === 0),
  );

  return (
    <WidgetFrame
      title={title}
      state={state}
      error={q.error}
      onRetry={() => void q.refetch()}
      emptyText="Chưa có công việc tạo mới hay xử lý trong kỳ này"
    >
      {points && (
        <div
          className="h-48"
          role="img"
          aria-label={`${title}: tạo mới ${points.reduce((s, p) => s + p.created, 0)}, đã xử lý ${points.reduce((s, p) => s + p.resolved, 0)}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ ...CHART_MARGIN, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={16} />
              <YAxis
                {...AXIS_PROPS}
                allowDecimals={false}
                axisLine={false}
                width={yAxisWidth(points.flatMap((p) => [p.created, p.resolved]))}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend
                verticalAlign="top"
                height={24}
                iconType="plainline"
                wrapperStyle={LEGEND_STYLE}
              />
              <Line
                type="monotone"
                dataKey="created"
                name="Tạo mới"
                stroke="var(--status-progress)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="resolved"
                name="Đã xử lý"
                stroke="var(--status-done)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetFrame>
  );
}
