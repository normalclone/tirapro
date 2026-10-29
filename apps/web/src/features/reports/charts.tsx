import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BurndownReport, VelocityReport } from '@tirapro/shared';
import { Skeleton } from '@/components/ui/primitives';
import { fmtDate, fmtDayMonth } from '@/lib/dateFormat';
import { burndownSummary, todayMarker, velocitySummary } from './burndown';

export const AXIS_PROPS = {
  tick: { fontSize: 11, fill: 'var(--muted)' },
  stroke: 'var(--border)',
  tickLine: false,
} as const;

export const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--ink)',
} as const;

export const LEGEND_STYLE = { fontSize: 11 } as const;

/* ------------------------------------------------------------------ */
/* Khung card & skeleton                                               */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className="print-avoid-break rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="text-sm font-medium text-muted">{title}</h3>
        {caption && <span className="text-xs text-faint">{caption}</span>}
      </div>
      {children}
    </div>
  );
}

export function ChartSkeleton() {
  return <Skeleton className="h-[260px] w-full" />;
}

/* ------------------------------------------------------------------ */
/* Burndown                                                            */
/* ------------------------------------------------------------------ */

/**
 * Điểm còn lại theo ngày so với đường lý tưởng. Những ngày chưa tới có `remaining = null` nên đường "Còn lại"
 * dừng ở hôm nay (`connectNulls={false}`), không kéo phẳng sang tương lai. Vạch "Hôm nay" chỉ vẽ khi sprint
 * chưa đóng và hôm nay nằm trong khoảng ngày của sprint.
 */
export function BurndownChart({
  report,
  closed = false,
}: {
  report: BurndownReport;
  closed?: boolean;
}) {
  const today = closed ? null : todayMarker(report.series, report.today);
  return (
    <div role="img" aria-label={burndownSummary(report)}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={report.series} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={fmtDayMonth} minTickGap={16} />
          <YAxis {...AXIS_PROPS} allowDecimals={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d: string) => fmtDate(d)} />
          <Legend wrapperStyle={LEGEND_STYLE} />
          {today && (
            <ReferenceLine
              x={today}
              stroke="var(--warning)"
              strokeWidth={1.5}
              label={{
                value: 'Hôm nay',
                position: 'top',
                fontSize: 11,
                fill: 'var(--warning-ink)',
              }}
            />
          )}
          <Line
            type="linear"
            dataKey="ideal"
            name="Lý tưởng"
            stroke="var(--muted)"
            strokeDasharray="4 4"
            dot={false}
          />
          <Line
            type="linear"
            dataKey="remaining"
            name="Còn lại"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Velocity                                                            */
/* ------------------------------------------------------------------ */

/** Độ mờ của cột sprint không được chọn khi có sprint nổi bật. */
const DIM = 0.4;

/**
 * Cam kết vs hoàn thành của các sprint đã đóng, kèm đường trung bình ("TB"). `highlightSprintId` làm nổi sprint
 * đang xem (các cột khác mờ đi) nếu nó có mặt trong danh sách.
 */
export function VelocityChart({
  report,
  highlightSprintId,
}: {
  report: VelocityReport;
  highlightSprintId?: string;
}) {
  const dim = !!highlightSprintId && report.sprints.some((s) => s.sprintId === highlightSprintId);
  const opacity = (id: string) => (dim && id !== highlightSprintId ? DIM : 1);
  return (
    <div role="img" aria-label={velocitySummary(report)}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={report.sprints} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="sprintName" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} allowDecimals={false} axisLine={false} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={LEGEND_STYLE} />
          <ReferenceLine
            y={report.averageCompleted}
            stroke="var(--muted)"
            strokeDasharray="4 4"
            label={{
              value: `TB ${report.averageCompleted}`,
              position: 'insideTopRight',
              fontSize: 11,
              fill: 'var(--muted)',
            }}
          />
          <Bar dataKey="committed" name="Cam kết" fill="var(--status-todo)" radius={[4, 4, 0, 0]}>
            {report.sprints.map((s) => (
              <Cell key={s.sprintId} fillOpacity={opacity(s.sprintId)} />
            ))}
          </Bar>
          <Bar dataKey="completed" name="Hoàn thành" fill="var(--primary)" radius={[4, 4, 0, 0]}>
            {report.sprints.map((s) => (
              <Cell key={s.sprintId} fillOpacity={opacity(s.sprintId)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
