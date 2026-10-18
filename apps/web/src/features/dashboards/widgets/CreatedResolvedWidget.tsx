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
import { useWorkspaceOverview } from '@/features/dashboard/api';
import { useCreatedResolved } from '@/features/reports/api';
import { AXIS_PROPS, LEGEND_STYLE, TOOLTIP_STYLE } from '@/features/reports/charts';
import { CHART_MARGIN, yAxisWidth } from '@/lib/chartAxis';
import { fmtDayMonth } from '@/lib/dateFormat';
import { cfgString } from '../widgetConfig';
import { queryWidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

interface Point {
  label: string;
  created: number;
  resolved: number;
}

/** Tạo mới vs Đã xử lý: theo ngày (một dự án) hoặc theo tuần (toàn workspace). */
export function CreatedResolvedWidget({ title, config }: WidgetProps) {
  const projectId = cfgString(config, 'projectId');
  const canReport = useAuth((s) => s.can('report:view'));
  const daily = useCreatedResolved(projectId);
  const weekly = useWorkspaceOverview(!projectId && canReport);

  if (!projectId && !canReport) {
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
