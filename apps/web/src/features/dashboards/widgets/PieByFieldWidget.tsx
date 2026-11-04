import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useAuth } from '@/stores/auth';
import type { OverviewSlice } from '@/features/dashboard/api';
import { useProjectReport } from '@/features/reports/api';
import { TOOLTIP_STYLE } from '@/features/reports/charts';
import { useWidgetScope } from '../scope/ScopeContext';
import { aggregateIds } from '../scope/widgetScope';
import { useScopedOverview, useScopedQa } from '../scope/scopedReports';
import {
  isPieField,
  isQaField,
  slicesFromOverview,
  slicesFromProject,
  slicesFromQa,
  type PieField,
} from '../pieSlices';
import { queryWidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

/** Màu dự phòng khi lát cắt không mang màu riêng (loại/ưu tiên của tổ chức thường có màu). */
const FALLBACK_COLORS = [
  'var(--primary)',
  'var(--status-progress)',
  'var(--status-done)',
  'var(--warning)',
  'var(--danger)',
  'var(--status-todo)',
];

/** Phân bố công việc theo trạng thái / loại / ưu tiên / mức nghiêm trọng / người phụ trách, theo phạm vi của ô. */
export function PieByFieldWidget({ title, config }: WidgetProps) {
  const field: PieField = isPieField(config.field) ? config.field : 'status';
  const scope = useWidgetScope(config);
  const projectId = scope.kind === 'project' ? scope.projectId : undefined;
  const canReport = useAuth((s) => s.can('report:view'));
  const fromQa = isQaField(field);
  const aggregated = scope.kind !== 'project';

  const overview = useScopedOverview(
    aggregateIds(scope),
    aggregated && canReport && !fromQa,
    field === 'assignee',
  );
  const report = useProjectReport(fromQa ? undefined : projectId);
  const qa = useScopedQa(scope, fromQa && (!aggregated || canReport));

  if (aggregated && !canReport) {
    return <WidgetFrame title={title} state="forbidden" forbiddenText="Cần quyền xem báo cáo" />;
  }

  const q = fromQa ? qa : projectId ? report : overview;
  let slices: OverviewSlice[] | undefined;
  if (fromQa) slices = qa.data ? slicesFromQa(qa.data) : undefined;
  else if (projectId) slices = report.data ? slicesFromProject(field, report.data) : undefined;
  else if (overview.data) slices = slicesFromOverview(field, overview.data);
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
