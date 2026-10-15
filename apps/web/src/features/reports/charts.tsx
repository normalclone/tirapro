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
import { fmtDate } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';
import { todayMarker } from './burndown';

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

/** `2026-10-14` → `14/10` cho nhãn trục X (đầy đủ ngày/tháng/năm nằm ở tooltip). */
function shortDay(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso;
}

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
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
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
/* Hàng chỉ số                                                         */
/* ------------------------------------------------------------------ */

export type StatTone = 'default' | 'progress' | 'done' | 'danger' | 'warning';

const STAT_TONE: Record<StatTone, string> = {
  default: 'text-ink-strong',
  progress: 'text-status-progress',
  done: 'text-status-done',
  danger: 'text-danger',
  warning: 'text-warning-ink',
};

export interface StatItem {
  label: string;
  value: number | string;
  /** Dòng phụ nhỏ dưới giá trị (đơn vị, số việc, khoảng ngày…). */
  sub?: string;
  tone?: StatTone;
  /** Nền nhấn nhẹ (vd quá hạn > 0). */
  highlight?: boolean;
}

/** Hàng chỉ số liền khối (không phải lưới thẻ lặp): mỗi ô nhãn + giá trị + dòng phụ. */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border',
        className,
      )}
    >
      {items.map((s) => (
        <div
          key={s.label}
          className={cn('px-4 py-2.5', s.highlight ? 'bg-danger/5' : 'bg-surface')}
        >
          <p className="text-xs font-medium text-muted">{s.label}</p>
          <p
            className={cn('mt-0.5 text-2xl font-semibold tabular', STAT_TONE[s.tone ?? 'default'])}
          >
            {s.value}
          </p>
          {s.sub && <p className="mt-0.5 truncate text-xs text-muted">{s.sub}</p>}
        </div>
      ))}
    </div>
  );
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
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={report.series} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={shortDay} minTickGap={16} />
        <YAxis {...AXIS_PROPS} allowDecimals={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d: string) => fmtDate(d)} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        {today && (
          <ReferenceLine
            x={today}
            stroke="var(--warning)"
            strokeWidth={1.5}
            label={{ value: 'Hôm nay', position: 'top', fontSize: 11, fill: 'var(--warning-ink)' }}
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
  );
}
