import { useMemo, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Users } from 'lucide-react';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useProjects } from '@/features/projects/api';
import { AllocationsPanel } from './AllocationsPanel';
import { TimeOffPanel } from './TimeOffPanel';
import { addDays, formatHours, isoDay, mondayOf, shortDay, useWorkload, type WorkloadCell, type WorkloadRow } from './api';

type Tab = 'load' | 'allocations' | 'time-off';

const WEEK_OPTIONS = [
  { value: '4', label: '4 tuần' },
  { value: '6', label: '6 tuần' },
  { value: '8', label: '8 tuần' },
  { value: '12', label: '12 tuần' },
];

type Level = 'none' | 'under' | 'balanced' | 'over';

/** Nhãn ngắn hiện trên bảng + câu giải nghĩa dùng cho tooltip. */
const LEVEL_META: Record<Level, { label: string; hint: string; tint: string | null }> = {
  none: { label: 'Chưa giao việc', hint: 'Tuần này người đó chưa được giao việc nào.', tint: null },
  under: {
    label: 'Nhẹ tải',
    hint: 'Việc được giao chiếm chưa tới 70% số giờ người đó làm được — còn nhận thêm được.',
    tint: 'var(--success)',
  },
  balanced: {
    label: 'Vừa tải',
    hint: 'Việc được giao chiếm 70–100% số giờ người đó làm được.',
    tint: 'var(--primary)',
  },
  over: {
    label: 'Quá tải',
    hint: 'Việc được giao nhiều hơn số giờ người đó làm được — nên giãn hạn hoặc chia bớt cho người khác.',
    tint: 'var(--danger)',
  },
};

function levelOf(cell: WorkloadCell): Level {
  if (cell.capacityHours <= 0) return cell.assignedHours > 0 ? 'over' : 'none';
  if (cell.assignedHours <= 0) return 'none';
  const r = cell.ratio ?? 0;
  if (r > 1) return 'over';
  return r < 0.7 ? 'under' : 'balanced';
}

/**
 * Nền ô: đậm dần theo tỉ lệ tải, luôn pha với `--surface` nên hợp cả sáng lẫn tối.
 *
 * PHẢI pha trong `oklab`, KHÔNG dùng `oklch`: `--surface` là màu trung tính có ám
 * nhẹ (hue 250). Pha trong oklch sẽ nội suy theo cung tròn sắc độ, kéo đỏ (hue 25)
 * vòng qua tím thành hue ~300 — ô "Quá tải" mất hẳn tín hiệu cảnh báo. oklab nội
 * suy theo toạ độ vuông góc nên giữ nguyên sắc.
 */
function cellStyle(cell: WorkloadCell, level: Level) {
  const tint = LEVEL_META[level].tint;
  if (!tint) return undefined;
  const r = cell.ratio ?? 1;
  const pct = level === 'over' ? Math.min(46, 28 + (r - 1) * 30) : Math.round(12 + Math.min(1, r) * 22);
  return { backgroundColor: `color-mix(in oklab, ${tint} ${pct}%, var(--surface))` };
}

/**
 * Nhân lực & khối lượng việc — bảng nhiệt NGƯỜI × TUẦN, phân bổ theo dự án,
 * nghỉ phép & ngày lễ chung.
 */
export function ResourcesPage() {
  const canManage = useAuth((s) => s.can('resource:manage'));
  const [tab, setTab] = useState<Tab>('load');
  const [startWeek, setStartWeek] = useState(() => isoDay(mondayOf(new Date())));
  const [weeks, setWeeks] = useState('6');
  const [projectId, setProjectId] = useState('');

  const from = startWeek;
  const to = useMemo(() => {
    const base = new Date(`${startWeek}T00:00:00`);
    if (Number.isNaN(base.getTime())) return startWeek;
    return isoDay(addDays(base, Number(weeks) * 7 - 1));
  }, [startWeek, weeks]);

  const { data: projects } = useProjects();
  const projectOptions = useMemo(
    () => [
      { value: '', label: 'Tất cả dự án' },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    ],
    [projects],
  );

  const workload = useWorkload({ from, to, projectId });
  const overloadedCount = workload.data?.rows.filter((r) => r.totals.overloaded).length ?? 0;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'load', label: 'Khối lượng theo tuần' },
    { id: 'allocations', label: 'Phân bổ' },
    { id: 'time-off', label: 'Nghỉ phép & ngày lễ' },
  ];

  return (
    <div className={pageContainer('xl')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Nhân lực & khối lượng việc</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Xem mỗi người đang gánh bao nhiêu giờ so với số giờ họ thật sự làm được.
          Số giờ làm được (năng lực) = ngày làm việc trong tuần, đã trừ nghỉ phép và ngày lễ, nhân tỉ lệ phân bổ;
          khối lượng việc = ước lượng giờ của các việc được giao, chia đều cho những ngày việc đó kéo dài.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted" title="Bảng luôn bắt đầu từ thứ Hai của tuần chứa ngày bạn chọn.">
            Xem từ tuần chứa ngày
          </span>
          <Input
            type="date"
            value={startWeek}
            onChange={(e) => setStartWeek(e.target.value ? isoDay(mondayOf(new Date(`${e.target.value}T00:00:00`))) : startWeek)}
            className="h-9 w-[10.5rem] text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Số tuần hiển thị</span>
          <SearchSelect
            value={weeks}
            onChange={setWeeks}
            options={WEEK_OPTIONS}
            ariaLabel="Số tuần hiển thị"
            className="w-[8.5rem]"
          />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5 sm:max-w-[18rem]">
          <span className="text-xs font-medium text-muted" title="Chỉ tính khối lượng việc thuộc dự án này. Để “Tất cả dự án” nếu muốn xem tổng.">
            Dự án
          </span>
          <SearchSelect
            value={projectId}
            onChange={setProjectId}
            options={projectOptions}
            ariaLabel="Lọc theo dự án"
            searchPlaceholder="Tìm dự án…"
          />
        </label>
        {tab === 'load' && workload.data && workload.data.rows.length > 0 && (
          <p
            className="pb-2 text-sm text-muted"
            title="Tổng số người trong bảng, kèm số người có ít nhất một tuần bị giao nhiều giờ hơn số giờ họ làm được."
          >
            {workload.data.rows.length} người
            {overloadedCount > 0 && <span className="text-danger"> · {overloadedCount} đang quá tải</span>}
          </p>
        )}
      </div>

      <div className="mb-5 flex gap-1 border-b border-border" role="tablist" aria-label="Xem theo">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              tab === t.id ? 'border-primary text-ink-strong' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'load' && (
        <section aria-label="Bảng khối lượng việc theo tuần">
          <Legend />
          {workload.isError ? (
            <QueryError onRetry={() => void workload.refetch()} />
          ) : workload.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : !workload.data || workload.data.rows.length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="Chưa có ai để tính khối lượng việc"
              description="Bảng này cho biết mỗi tuần một người gánh bao nhiêu giờ. Hãy mời người vào không gian làm việc, rồi phân bổ họ vào dự án."
            />
          ) : (
            <HeatMap rows={workload.data.rows} weeks={workload.data.weeks} hoursPerDay={workload.data.hoursPerDay} />
          )}
        </section>
      )}

      {tab === 'allocations' && (
        <AllocationsPanel canManage={canManage} projectId={projectId} from={from} to={to} />
      )}

      {tab === 'time-off' && <TimeOffPanel canManage={canManage} from={from} to={to} />}
    </div>
  );
}

function Legend() {
  const items: Level[] = ['none', 'under', 'balanced', 'over'];
  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {items.map((lv) => (
        <li key={lv} className="flex items-center gap-1.5" title={LEVEL_META[lv].hint}>
          <span
            className="h-3 w-3 rounded-sm border border-border"
            style={LEVEL_META[lv].tint ? { backgroundColor: `color-mix(in oklab, ${LEVEL_META[lv].tint} 30%, var(--surface))` } : { backgroundColor: 'var(--surface-2)' }}
            aria-hidden
          />
          {LEVEL_META[lv].label}
        </li>
      ))}
      <li className="text-faint" title="Ví dụ: được giao 52h trong tuần mà chỉ làm được 40h thì hiện 130% và tô đỏ.">
        Phần trăm = số giờ được giao ÷ số giờ làm được trong tuần
      </li>
    </ul>
  );
}

function HeatMap({
  rows,
  weeks,
  hoursPerDay,
}: {
  rows: WorkloadRow[];
  weeks: { start: string; end: string; label: string }[];
  hoursPerDay: number;
}) {
  return (
    <Tooltip.Provider delayDuration={0} skipDelayDuration={0}>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Khối lượng việc theo từng người và từng tuần</caption>
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="sticky left-0 z-[1] bg-surface px-4 py-2.5 text-left text-xs font-medium text-muted"
              >
                Thành viên
              </th>
              {weeks.map((w) => (
                <th
                  key={w.start}
                  scope="col"
                  className="min-w-[5.5rem] px-2 py-2.5 text-center text-xs font-medium text-muted"
                  title={`Tuần ${shortDay(w.start)} – ${shortDay(w.end)}`}
                >
                  {w.label}
                </th>
              ))}
              <th
                scope="col"
                className="min-w-[6rem] px-3 py-2.5 text-right text-xs font-medium text-muted"
                title="Cộng dồn toàn bộ khoảng đang xem: số giờ được giao trên số giờ làm được."
              >
                Cả kỳ
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user.id} className="border-b border-border last:border-0">
                <th
                  scope="row"
                  className="sticky left-0 z-[1] max-w-[16rem] bg-surface px-4 py-2 text-left font-normal"
                >
                  <span className="flex items-center gap-2">
                    <Avatar name={row.user.displayName} src={row.user.avatarUrl} size={26} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{row.user.displayName}</span>
                      {row.usesDefaultCapacity && (
                        <span
                          className="block truncate text-[11px] text-faint"
                          title="Người này chưa được phân bổ vào dự án nào trong khoảng đang xem, nên tạm tính là làm toàn thời gian (100%)."
                        >
                          Chưa phân bổ · tạm tính 100%
                        </span>
                      )}
                    </span>
                  </span>
                </th>

                {row.weeks.map((cell) => (
                  <LoadCell key={cell.weekStart} cell={cell} name={row.user.displayName} hoursPerDay={hoursPerDay} />
                ))}

                <td
                  className="px-3 py-2 text-right tabular-nums"
                  title={`Cả kỳ: được giao ${formatHours(row.totals.assignedHours)} trên ${formatHours(row.totals.capacityHours)} giờ làm được.${row.totals.overloaded ? ' Tổng đã vượt số giờ làm được.' : ''}`}
                >
                  <span className={cn('text-sm', row.totals.overloaded ? 'font-medium text-danger' : 'text-ink')}>
                    {formatHours(row.totals.assignedHours)}
                  </span>
                  <span className="block text-[11px] text-faint">/ {formatHours(row.totals.capacityHours)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tooltip.Provider>
  );
}

function LoadCell({ cell, name, hoursPerDay }: { cell: WorkloadCell; name: string; hoursPerDay: number }) {
  const level = levelOf(cell);
  const meta = LEVEL_META[level];
  const percent = cell.ratio != null ? Math.round(cell.ratio * 100) : null;
  const label = `${name}, tuần bắt đầu ${shortDay(cell.weekStart)}: ${meta.label}, được giao ${formatHours(cell.assignedHours)} trên ${formatHours(cell.capacityHours)} giờ làm được`;

  return (
    <td className="p-1 text-center align-middle">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            tabIndex={0}
            role="img"
            aria-label={label}
            style={cellStyle(cell, level)}
            className={cn(
              'flex h-11 flex-col items-center justify-center rounded-md border transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              meta.tint ? 'border-transparent' : 'border-dashed border-border bg-surface-2',
            )}
          >
            <span className="text-sm font-medium tabular-nums text-ink-strong">
              {cell.assignedHours > 0 ? formatHours(cell.assignedHours) : '—'}
            </span>
            <span className="text-[11px] tabular-nums text-ink/70">
              {cell.workingDays === 0 ? 'Nghỉ cả tuần' : percent != null ? `${percent}%` : 'Chưa phân bổ'}
            </span>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            className="z-tooltip w-56 rounded-lg border border-border bg-surface p-3 text-xs shadow-lg animate-in fade-in zoom-in-95 duration-150"
          >
            <p className="mb-2 font-medium text-ink-strong">Tuần bắt đầu {shortDay(cell.weekStart)}</p>
            <dl className="space-y-1 text-muted">
              <Line label="Làm được" value={formatHours(cell.capacityHours)} />
              <Line label="Được giao" value={formatHours(cell.assignedHours)} strong={cell.overloaded} />
              <Line label="Đã chấm công" value={formatHours(cell.loggedHours)} />
              <Line label="Ngày làm việc" value={`${cell.workingDays} ngày${cell.offDays ? ` · nghỉ ${cell.offDays}` : ''}`} />
              <Line label="Tỉ lệ phân bổ" value={`${cell.allocationPercent}% · ${hoursPerDay}h/ngày`} />
              <Line label="Số việc đang giao" value={`${cell.issueCount}`} />
            </dl>
            <p className={cn('mt-2 font-medium', cell.overloaded ? 'text-danger' : 'text-ink')}>{meta.label}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">{meta.hint}</p>
            <Tooltip.Arrow className="fill-[var(--border)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </td>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'font-medium text-danger' : 'text-ink')}>{value}</dd>
    </div>
  );
}
