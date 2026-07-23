import { useParams } from 'react-router-dom';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ReactNode } from 'react';
import { useProject } from '@/features/projects/api';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { cn } from '@/lib/utils';
import {
  useBurndown,
  useCfd,
  useCreatedResolved,
  useProjectReport,
  useProjectSprints,
  useVelocity,
  type ProjectReportTotals,
  type ReportAssignee,
  type ReportSlice,
} from './api';

const AXIS_PROPS = {
  tick: { fontSize: 11, fill: 'var(--muted)' },
  stroke: 'var(--border)',
  tickLine: false,
} as const;

const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--ink)',
} as const;

const LEGEND_STYLE = { fontSize: 11 } as const;

export function ReportsPage() {
  const { key = '' } = useParams();
  const { data: project, isError: pe, error: pErr, refetch: refetchProject } = useProject(key);
  const projectId = project?.id;

  const report = useProjectReport(projectId);
  const { data: sprints } = useProjectSprints(projectId);
  const burndownSprint = sprints?.find((s) => s.state === 'ACTIVE') ?? sprints?.[0];

  const burndown = useBurndown(burndownSprint?.id);
  const velocity = useVelocity(projectId);
  const cfd = useCfd(projectId);
  const createdResolved = useCreatedResolved(projectId);

  // Lỗi tải project (→ tránh skeleton treo mãi) hoặc lỗi tải báo cáo chính.
  if (pe || report.isError) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-6 py-3">
          <span className="text-sm font-medium text-ink">Báo cáo</span>
        </div>
        <div className="p-6">
          <QueryError
            error={pErr ?? report.error}
            onRetry={() => { void refetchProject(); void report.refetch(); }}
          />
        </div>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-6 py-3">
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[300px]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="space-y-4 p-4">
        {/* Số liệu tổng hợp */}
        {report.isLoading ? (
          <Skeleton className="h-[76px] w-full" />
        ) : report.data && report.data.totals.total > 0 ? (
          <SummaryStats totals={report.data.totals} completionRate={report.data.completionRate} />
        ) : null}

        {/* Phân bố: trạng thái · loại · độ ưu tiên */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Phân bố trạng thái">
            {report.isLoading ? (
              <ChartSkeleton />
            ) : !report.data || report.data.byStatus.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" description="Dự án chưa có issue nào." />
            ) : (
              <StatusDonut slices={report.data.byStatus} />
            )}
          </Card>

          <Card title="Issue theo loại">
            {report.isLoading ? (
              <ChartSkeleton />
            ) : !report.data || report.data.byType.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" />
            ) : (
              <SliceBar slices={report.data.byType} />
            )}
          </Card>

          <Card title="Issue theo độ ưu tiên">
            {report.isLoading ? (
              <ChartSkeleton />
            ) : !report.data || report.data.byPriority.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" />
            ) : (
              <SliceBar slices={report.data.byPriority} />
            )}
          </Card>
        </div>

        {/* Khối lượng theo người phụ trách: biểu đồ + bảng chi tiết */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title="Khối lượng theo người phụ trách" caption="Số issue được giao">
            {report.isLoading ? (
              <ChartSkeleton />
            ) : !report.data || report.data.byAssignee.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" description="Chưa có issue nào được giao." />
            ) : (
              <AssigneeBar rows={report.data.byAssignee} />
            )}
          </Card>

          <Card title="Chi tiết theo người phụ trách">
            {report.isLoading ? (
              <ChartSkeleton />
            ) : !report.data || report.data.byAssignee.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" />
            ) : (
              <AssigneeTable rows={report.data.byAssignee} />
            )}
          </Card>
        </div>

        {/* Xu hướng theo thời gian & sprint */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title="Burndown">
            {!burndownSprint ? (
              <EmptyState title="Chưa có sprint đang chạy" />
            ) : burndown.isLoading ? (
              <ChartSkeleton />
            ) : !burndown.data || burndown.data.series.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" description="Sprint chưa có dữ liệu burndown." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={burndown.data.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                  <Line
                    type="monotone"
                    dataKey="ideal"
                    name="Lý tưởng"
                    stroke="var(--muted)"
                    strokeDasharray="4 4"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="remaining"
                    name="Còn lại"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card
            title="Velocity"
            caption={
              velocity.data ? `Trung bình hoàn thành: ${velocity.data.averageCompleted}` : undefined
            }
          >
            {velocity.isLoading ? (
              <ChartSkeleton />
            ) : !velocity.data || velocity.data.sprints.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" description="Chưa có sprint nào đã hoàn thành." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={velocity.data.sprints}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="sprintName" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                  <Bar dataKey="committed" name="Cam kết" fill="var(--status-todo)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" name="Hoàn thành" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Cumulative Flow">
            {cfd.isLoading ? (
              <ChartSkeleton />
            ) : !cfd.data || cfd.data.series.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" description="Chưa đủ dữ liệu để dựng biểu đồ." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={cfd.data.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="todo"
                    name="Cần làm"
                    stackId="1"
                    stroke="var(--status-todo)"
                    fill="var(--status-todo)"
                  />
                  <Area
                    type="monotone"
                    dataKey="inProgress"
                    name="Đang làm"
                    stackId="1"
                    stroke="var(--status-progress)"
                    fill="var(--status-progress)"
                  />
                  <Area
                    type="monotone"
                    dataKey="done"
                    name="Hoàn thành"
                    stackId="1"
                    stroke="var(--status-done)"
                    fill="var(--status-done)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Tạo mới vs Đã xử lý">
            {createdResolved.isLoading ? (
              <ChartSkeleton />
            ) : !createdResolved.data || createdResolved.data.series.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" description="Chưa có hoạt động trong khoảng này." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={createdResolved.data.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
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
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Số liệu tổng hợp                                                    */
/* ------------------------------------------------------------------ */

type StatTone = 'default' | 'progress' | 'done' | 'danger';

const STAT_TONE: Record<StatTone, string> = {
  default: 'text-ink-strong',
  progress: 'text-status-progress',
  done: 'text-status-done',
  danger: 'text-danger',
};

function SummaryStats({
  totals,
  completionRate,
}: {
  totals: ProjectReportTotals;
  completionRate: number;
}) {
  const stats: { label: string; value: number | string; tone?: StatTone }[] = [
    { label: 'Tổng issue', value: totals.total },
    { label: 'Cần làm', value: totals.todo },
    { label: 'Đang làm', value: totals.inProgress, tone: 'progress' },
    { label: 'Hoàn thành', value: totals.done, tone: 'done' },
    { label: 'Quá hạn', value: totals.overdue, tone: 'danger' },
    { label: 'Story points', value: totals.points },
    { label: 'Hoàn tất', value: `${completionRate}%`, tone: 'done' },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 xl:grid-cols-7">
      {stats.map((s) => {
        const tone = s.tone ?? 'default';
        const highlight = tone === 'danger' && Number(s.value) > 0;
        return (
          <div key={s.label} className={cn('px-4 py-2.5', highlight ? 'bg-danger/5' : 'bg-surface')}>
            <p className="text-xs font-medium text-muted">{s.label}</p>
            <p className={cn('mt-0.5 text-2xl font-semibold tabular', STAT_TONE[tone])}>{s.value}</p>
          </div>
        );
      })}
    </div>
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
      <BarChart data={slices} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" {...AXIS_PROPS} interval={0} />
        <YAxis allowDecimals={false} {...AXIS_PROPS} width={32} axisLine={false} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="count" name="Số issue" radius={[4, 4, 0, 0]} maxBarSize={56}>
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
        <Bar dataKey="remaining" name="Cần làm" stackId="a" fill="var(--status-todo)" radius={[3, 0, 0, 3]} />
        <Bar dataKey="inProgress" name="Đang làm" stackId="a" fill="var(--status-progress)" />
        <Bar dataKey="done" name="Hoàn thành" stackId="a" fill="var(--status-done)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AssigneeTable({ rows }: { rows: ReportAssignee[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-faint">
            <th className="py-2 pr-2 font-medium">Người phụ trách</th>
            <th className="w-14 py-2 px-1 text-right font-medium tabular">Tổng</th>
            <th className="w-16 py-2 px-1 text-right font-medium tabular">Đang làm</th>
            <th className="w-14 py-2 px-1 text-right font-medium tabular">Xong</th>
            <th className="w-16 py-2 px-1 text-right font-medium tabular">Quá hạn</th>
            <th className="w-14 py-2 pl-1 text-right font-medium tabular">Điểm</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id ?? '__unassigned__'} className="transition-colors hover:bg-surface-2">
              <td className="py-2 pr-2">
                <span className={cn('truncate', r.id === null ? 'text-muted italic' : 'text-ink-strong')}>
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Khung card & skeleton                                               */
/* ------------------------------------------------------------------ */

function Card({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        {caption && <span className="text-xs text-faint">{caption}</span>}
      </div>
      {children}
    </div>
  );
}

function ChartSkeleton() {
  return <Skeleton className="h-[260px] w-full" />;
}
