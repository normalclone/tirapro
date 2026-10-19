import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { CHART_MARGIN, yAxisWidth } from '@/lib/chartAxis';
import { cn } from '@/lib/utils';
import { HealthOverrideCard } from '@/features/projects/HealthOverrideCard';
import {
  useProjectReport,
  type ProjectReportTotals,
  type ReportAssignee,
  type ReportSlice,
} from './api';
import {
  AXIS_PROPS,
  Card,
  ChartSkeleton,
  LEGEND_STYLE,
  StatStrip,
  TOOLTIP_STYLE,
  type StatItem,
} from './charts';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';
import { ScrollX } from '@/components/ui/ScrollX';

/** Tab "Tổng quan": số liệu tổng hợp, phân bố trạng thái/loại/ưu tiên và khối lượng theo người phụ trách. */
export function OverviewTab({
  project,
}: {
  project: { id: string; key: string; archivedAt: string | null };
}) {
  const report = useProjectReport(project.id);

  if (report.isError) {
    return <QueryError error={report.error} onRetry={() => void report.refetch()} />;
  }

  return (
    <div className="space-y-4">
      {/* Sức khoẻ dự án: tự tính + ghi đè của PM */}
      {report.isLoading ? (
        <Skeleton className="h-[120px] w-full" />
      ) : (
        report.data && <HealthOverrideCard project={project} health={report.data.health} />
      )}

      {/* Số liệu tổng hợp */}
      {report.isLoading ? (
        <Skeleton className="h-[76px] w-full" />
      ) : report.data && report.data.totals.total > 0 ? (
        <SummaryStats totals={report.data.totals} completionRate={report.data.completionRate} />
      ) : null}

      {/* Phân bố: trạng thái · loại · mức ưu tiên */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Phân bố trạng thái">
          {report.isLoading ? (
            <ChartSkeleton />
          ) : !report.data || report.data.byStatus.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<BarChart3 />}
              title="Chưa có dữ liệu"
              description="Biểu đồ hiện khi dự án có ít nhất một công việc. Tạo công việc đầu tiên ở Bảng hoặc Việc chờ."
            />
          ) : (
            <StatusDonut slices={report.data.byStatus} />
          )}
        </Card>

        <Card title="Công việc theo loại">
          {report.isLoading ? (
            <ChartSkeleton />
          ) : !report.data || report.data.byType.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<BarChart3 />}
              title="Chưa có dữ liệu"
              description="Biểu đồ hiện khi dự án có công việc; mỗi công việc thuộc một loại."
            />
          ) : (
            <SliceBar slices={report.data.byType} />
          )}
        </Card>

        <Card title="Công việc theo mức ưu tiên">
          {report.isLoading ? (
            <ChartSkeleton />
          ) : !report.data || report.data.byPriority.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<BarChart3 />}
              title="Chưa có dữ liệu"
              description="Biểu đồ hiện khi dự án có công việc (việc chưa đặt ưu tiên được tính vào “Chưa đặt”)."
            />
          ) : (
            <SliceBar slices={report.data.byPriority} />
          )}
        </Card>
      </div>

      {/* Khối lượng theo người phụ trách: biểu đồ + bảng chi tiết */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Khối lượng theo người phụ trách" caption="Số công việc được giao">
          {report.isLoading ? (
            <ChartSkeleton />
          ) : !report.data || report.data.byAssignee.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<BarChart3 />}
              title="Chưa có dữ liệu"
              description="Biểu đồ hiện khi dự án có công việc; việc chưa giao được tính vào “Chưa gán”. Gán người phụ trách để xem khối lượng chia đều tới đâu."
            />
          ) : (
            <AssigneeBar rows={report.data.byAssignee} />
          )}
        </Card>

        <Card title="Chi tiết theo người phụ trách">
          {report.isLoading ? (
            <ChartSkeleton />
          ) : !report.data || report.data.byAssignee.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<BarChart3 />}
              title="Chưa có dữ liệu"
              description="Bảng hiện khi dự án có ít nhất một công việc."
            />
          ) : (
            <AssigneeTable rows={report.data.byAssignee} />
          )}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Số liệu tổng hợp                                                    */
/* ------------------------------------------------------------------ */

function SummaryStats({
  totals,
  completionRate,
}: {
  totals: ProjectReportTotals;
  completionRate: number;
}) {
  const items: StatItem[] = [
    { label: 'Tổng công việc', value: totals.total },
    { label: STATUS_CATEGORY_LABEL.TODO, value: totals.todo },
    { label: STATUS_CATEGORY_LABEL.IN_PROGRESS, value: totals.inProgress, tone: 'progress' },
    { label: STATUS_CATEGORY_LABEL.DONE, value: totals.done, tone: 'done' },
    {
      label: 'Quá hạn',
      value: totals.overdue,
      tone: 'danger',
      highlight: totals.overdue > 0,
    },
    { label: 'Story points', value: totals.points },
    { label: 'Hoàn tất', value: `${completionRate}%`, tone: 'done' },
  ];
  return (
    <StatStrip
      items={items}
      className="sm:grid-cols-4 xl:grid-cols-7 max-sm:[&>:last-child:nth-child(odd)]:col-span-2"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Sơ đồ phân bố                                                       */
/* ------------------------------------------------------------------ */

function StatusDonut({ slices }: { slices: ReportSlice[] }) {
  const data = slices.filter((s) => s.count > 0);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="name"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          stroke="none"
        >
          {data.map((s) => (
            <Cell key={s.name} fill={s.color ?? 'var(--primary)'} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend verticalAlign="bottom" height={24} iconType="circle" wrapperStyle={LEGEND_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function SliceBar({ slices }: { slices: ReportSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={slices} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" {...AXIS_PROPS} interval={0} />
        <YAxis
          allowDecimals={false}
          {...AXIS_PROPS}
          width={yAxisWidth(slices.map((s) => s.count))}
          axisLine={false}
        />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="count" name="Số công việc" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {slices.map((s) => (
            <Cell key={s.name} fill={s.color ?? 'var(--primary)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Người phụ trách                                                     */
/* ------------------------------------------------------------------ */

/** Rút gọn tên dài để nhãn trục Y không tràn. */
function shortName(name: string): string {
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}

function AssigneeBar({ rows }: { rows: ReportAssignee[] }) {
  // Giới hạn 8 hàng đầu để biểu đồ không bị nén; đủ để nhìn phân bố tải.
  const data = rows.slice(0, 8).map((r) => ({
    name: shortName(r.name),
    inProgress: r.inProgress,
    done: r.done,
    remaining: Math.max(r.total - r.inProgress - r.done, 0),
  }));
  const height = Math.max(data.length * 34 + 48, 160);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
        <YAxis type="category" dataKey="name" width={110} {...AXIS_PROPS} axisLine={false} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        <Bar
          dataKey="remaining"
          name={STATUS_CATEGORY_LABEL.TODO}
          stackId="a"
          fill="var(--status-todo)"
          radius={[3, 0, 0, 3]}
        />
        <Bar
          dataKey="inProgress"
          name={STATUS_CATEGORY_LABEL.IN_PROGRESS}
          stackId="a"
          fill="var(--status-progress)"
        />
        <Bar
          dataKey="done"
          name={STATUS_CATEGORY_LABEL.DONE}
          stackId="a"
          fill="var(--status-done)"
          radius={[0, 3, 3, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AssigneeTable({ rows }: { rows: ReportAssignee[] }) {
  return (
    <ScrollX>
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-faint">
            <th className="py-2 pr-2 font-medium">Người phụ trách</th>
            <th className="w-14 py-2 px-1 text-right font-medium tabular">Tổng</th>
            <th className="w-24 whitespace-nowrap py-2 px-1 text-right font-medium tabular">
              {STATUS_CATEGORY_LABEL.IN_PROGRESS}
            </th>
            <th className="w-14 py-2 px-1 text-right font-medium tabular">
              {STATUS_CATEGORY_LABEL.DONE}
            </th>
            <th className="w-16 py-2 px-1 text-right font-medium tabular">Quá hạn</th>
            <th className="w-14 py-2 pl-1 text-right font-medium tabular">Điểm</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id ?? '__unassigned__'} className="transition-colors hover:bg-surface-2">
              <td className="py-2 pr-2">
                <span
                  className={cn(
                    'truncate',
                    r.id === null ? 'text-muted italic' : 'text-ink-strong',
                  )}
                >
                  {r.name}
                </span>
              </td>
              <td className="py-2 px-1 text-right tabular text-ink-strong">{r.total}</td>
              <td className="py-2 px-1 text-right tabular text-status-progress">{r.inProgress}</td>
              <td className="py-2 px-1 text-right tabular text-status-done">{r.done}</td>
              <td
                className={cn(
                  'py-2 px-1 text-right tabular',
                  r.overdue > 0 ? 'font-semibold text-danger' : 'text-faint',
                )}
              >
                {r.overdue}
              </td>
              <td className="py-2 pl-1 text-right tabular text-muted">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}
