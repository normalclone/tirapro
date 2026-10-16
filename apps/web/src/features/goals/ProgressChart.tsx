import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '@/components/ui/primitives';
import { fmtDate } from '@/lib/dateFormat';
import { AXIS_PROPS, TOOLTIP_STYLE } from '@/features/reports/charts';
import { CHART_MARGIN } from '@/lib/chartAxis';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { useProgressHistory, type GoalDto, type GoalProgressHistory } from './api';
import { formatKrValue } from './krFormat';
import { buildSeries, type SeriesLine, type SeriesRow } from './progressSeries';

const SERIES_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--series-${n})`);
const colorOf = (index: number): string => SERIES_COLORS[index % SERIES_COLORS.length]!;

/** `2026-10-14` → `14/10` cho nhãn trục X (đầy đủ ở tooltip). */
const shortDay = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

interface TooltipPayload {
  payload?: SeriesRow;
}

/** Tooltip: ngày, tiến độ mục tiêu, mốc kỳ vọng và giá trị THẬT của từng KR kèm đơn vị. */
function ChartTooltip({
  active,
  payload,
  lines,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  lines: SeriesLine[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 shadow-md">
      <p className="mb-1 font-medium">{fmtDate(row.date)}</p>
      {row.objective !== null && (
        <p className="tabular-nums">
          <span className="font-semibold">Mục tiêu</span>: {row.objective}%
        </p>
      )}
      {row.expected !== null && (
        <p className="tabular-nums text-muted">
          Kỳ vọng theo thời gian: {Math.round(row.expected)}%
        </p>
      )}
      {lines.map((line, i) =>
        row.value[i] === null || row.value[i] === undefined ? null : (
          <p key={line.id} className="tabular-nums">
            <span
              aria-hidden
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ background: colorOf(i) }}
            />
            {line.name}: {formatKrValue(row.value[i], line.unit, line.unitLabel)} ({row.progress[i]}
            %)
          </p>
        ),
      )}
    </div>
  );
}

/**
 * Đường tiến độ theo ngày của một mục tiêu (L29): mỗi KR một đường, đường mục tiêu đậm, mốc kỳ vọng nét đứt.
 * Dữ liệu từ check-in tay + bản chụp tự động hằng ngày; KR tự đo ở dự án riêng tư người xem không thấy chỉ hiện chú thích.
 */
export function ProgressChart({ goal }: { goal: GoalDto }) {
  const query = useProgressHistory(goal.id, true);
  return (
    <QueryBoundary query={query} skeleton={<Skeleton className="h-[240px] w-full" />}>
      {(data) => <ProgressChartBody goal={goal} data={data} />}
    </QueryBoundary>
  );
}

function ProgressChartBody({ goal, data }: { goal: GoalDto; data: GoalProgressHistory }) {
  const { rows, lines } = useMemo(() => buildSeries(data), [data]);
  const hasData = lines.some((l) => l.hasData);
  const hiddenNotes = lines.filter((l) => l.scopeNote);
  const publicNote = data.keyResults.some((kr) => kr.source !== 'MANUAL' && kr.points.length > 0);

  if (!hasData) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
        <p className="text-sm text-ink">Chưa có lịch sử tiến độ.</p>
        <p className="mt-1 text-xs text-faint">
          Hệ thống ghi lại giá trị mỗi ngày lúc 01:30 UTC (khoảng 8:30 sáng giờ Việt Nam) — đường
          tiến độ sẽ hiện từ ngày mai.
        </p>
        {hiddenNotes.map((l) => (
          <p key={l.id} className="mt-1 text-xs text-faint">
            {l.name}: {l.scopeNote}
          </p>
        ))}
      </div>
    );
  }

  const summary = `Đường tiến độ ${goal.name}: tiến độ hiện tại ${goal.progress}%, ${lines.filter((l) => l.hasData).length} kết quả then chốt`;
  const today = rows.some((r) => r.date === data.to) ? data.to : null;

  return (
    <div>
      <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={rows} margin={{ ...CHART_MARGIN, top: 20, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={shortDay} minTickGap={24} />
            <YAxis
              {...AXIS_PROPS}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              width={40}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip lines={lines} />} />
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
            {data.expected && (
              <Line
                type="linear"
                dataKey="expected"
                name="Kỳ vọng theo thời gian"
                stroke="var(--muted)"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {lines.map((line, i) =>
              line.hasData ? (
                <Line
                  key={line.id}
                  type="stepAfter"
                  dataKey={(r: SeriesRow) => r.progress[i]}
                  name={line.name}
                  stroke={colorOf(i)}
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : null,
            )}
            <Line
              type="monotone"
              dataKey="objective"
              name="Mục tiêu"
              stroke="var(--ink-strong)"
              strokeWidth={3}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Chú giải">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-0.5 w-4 rounded bg-ink-strong"
            style={{ height: 3 }}
          />
          Mục tiêu (trung bình)
        </li>
        {data.expected && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-muted" />
            Kỳ vọng theo thời gian
          </li>
        )}
        {lines.map((line, i) =>
          line.hasData ? (
            <li key={line.id} className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0.5 w-4 shrink-0 rounded"
                style={{ background: colorOf(i), height: 3 }}
              />
              <span className="truncate" title={line.name}>
                {line.name}
              </span>
            </li>
          ) : null,
        )}
      </ul>
      {hiddenNotes.map((l) => (
        <p key={l.id} className="mt-1 text-xs text-faint">
          {l.name}: {l.scopeNote}
        </p>
      ))}
      {publicNote && (
        <p className="mt-1 text-xs text-faint">
          Ngày tính theo giờ UTC. Lịch sử tính trên dự án công khai — số “hiện tại” của KR tự đo có
          thể khác nếu bạn thấy cả dự án riêng tư.
        </p>
      )}
    </div>
  );
}
