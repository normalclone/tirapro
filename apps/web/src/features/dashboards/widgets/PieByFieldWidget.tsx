import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useAuth } from '@/stores/auth';
import { useWorkspaceOverview, type OverviewSlice } from '@/features/dashboard/api';
import { useProjectReport } from '@/features/reports/api';
import { TOOLTIP_STYLE } from '@/features/reports/charts';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';
import { cfgString } from '../widgetConfig';
import { queryWidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

/** Màu dự phòng khi lát cắt không mang màu riêng (loại/ưu tiên của workspace thường có màu). */
const FALLBACK_COLORS = [
  'var(--primary)',
  'var(--status-progress)',
  'var(--status-done)',
  'var(--warning)',
  'var(--danger)',
  'var(--status-todo)',
];

type Field = 'status' | 'type' | 'priority';
const isField = (v: unknown): v is Field => v === 'status' || v === 'type' || v === 'priority';

/** Phân bố công việc theo trạng thái / loại / ưu tiên, của một dự án hoặc toàn workspace. */
export function PieByFieldWidget({ title, config }: WidgetProps) {
  const field: Field = isField(config.field) ? config.field : 'status';
  const projectId = cfgString(config, 'projectId');
  const canReport = useAuth((s) => s.can('report:view'));

  const overview = useWorkspaceOverview(!projectId && canReport);
  const report = useProjectReport(projectId);

  if (!projectId && !canReport) {
    return <WidgetFrame title={title} state="forbidden" forbiddenText="Cần quyền xem báo cáo" />;
  }

  const q = projectId ? report : overview;
  let slices: OverviewSlice[] | undefined;
  if (projectId && report.data) {
    slices =
      field === 'type'
        ? report.data.byType
        : field === 'priority'
          ? report.data.byPriority
          : report.data.byStatus;
  } else if (!projectId && overview.data) {
    const t = overview.data.totals;
    slices =
      field === 'type'
        ? overview.data.byType
        : field === 'priority'
          ? overview.data.byPriority
          : [
              { name: STATUS_CATEGORY_LABEL.TODO, color: 'var(--status-todo)', count: t.todo },
              {
                name: STATUS_CATEGORY_LABEL.IN_PROGRESS,
                color: 'var(--status-progress)',
                count: t.inProgress,
              },
              { name: STATUS_CATEGORY_LABEL.DONE, color: 'var(--status-done)', count: t.done },
            ];
  }
  const data = (slices ?? []).filter((s) => s.count > 0);
  const state = queryWidgetState(
    { data: slices ? data : undefined, isError: q.isError, error: q.error },
    (d) => d.length === 0,
  );

  return (
    <WidgetFrame
      title={title}
      state={state}
      error={q.error}
      onRetry={() => void q.refetch()}
      emptyText="Chưa có công việc để thống kê"
    >
      <div
        className="h-48"
        role="img"
        aria-label={`${title}: ${data.map((d) => `${d.name} ${d.count}`).join(', ')}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="name"
              innerRadius="58%"
              outerRadius="82%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d, i) => (
                <Cell key={d.name} fill={d.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend
              verticalAlign="bottom"
              height={24}
              iconType="circle"
              wrapperStyle={{ fontSize: 11 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </WidgetFrame>
  );
}
