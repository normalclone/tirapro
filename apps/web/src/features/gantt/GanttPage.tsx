import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import { CalendarRange, Camera, Link2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import { useProjectIssues } from '@/features/backlog/api';
import { DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { QueryError } from '@/components/ui/QueryError';
import { isOverdue } from '@/components/ui/DueBadge';
import { categoryColor } from '@/lib/statusColor';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { PlanningPanel } from '@/features/planning/PlanningPanel';
import {
  useBaseline,
  useBaselines,
  useCreateBaseline,
  useDependencies,
  useMilestones,
  useSchedule,
  type BaselineItemDto,
  type DependencyDto,
  type MilestoneDto,
  type ScheduleItemDto,
} from '@/features/planning/api';

const LABEL_W = 240;
const DAY_W = 30;
const ROW_H = 40;
/** Chiều cao thật của một hàng = ROW_H + 1px viền dưới → dùng để đặt mũi tên phụ thuộc. */
const ROW_STRIDE = ROW_H + 1;
const MAX_DAYS = 220;

interface Span {
  issue: IssueDto;
  start: Date;
  end: Date;
  overdue: boolean;
  /** Không có ngày thật — suy ra từ ràng buộc phụ thuộc. */
  inferred: boolean;
  critical: boolean;
  slackDays: number | null;
  baseStart: Date | null;
  baseEnd: Date | null;
}

interface BarBox {
  row: number;
  left: number;
  right: number;
  y: number;
}

/** Toạ độ mũi tên nối hai thanh theo loại phụ thuộc (FS/SS/FF/SF). */
function dependencyPath(dep: DependencyDto, from: BarBox, to: BarBox) {
  const fromRight = dep.type === 'FS' || dep.type === 'FF';
  const toRight = dep.type === 'FF' || dep.type === 'SF';
  const x1 = fromRight ? from.right : from.left;
  const x2 = toRight ? to.right : to.left;
  const tipX = toRight ? x2 + 2 : x2 - 2;
  const lineEndX = toRight ? tipX + 6 : tipX - 6;
  const stubX = x1 + (fromRight ? 10 : -10);

  const straight = toRight ? stubX > lineEndX : stubX < lineEndX;
  const d = straight
    ? `M${x1} ${from.y} H${stubX} V${to.y} H${lineEndX}`
    : (() => {
        const midY = to.y >= from.y ? from.y + ROW_STRIDE / 2 : from.y - ROW_STRIDE / 2;
        const backX = x2 + (toRight ? 20 : -20);
        return `M${x1} ${from.y} H${stubX} V${midY} H${backX} V${to.y} H${lineEndX}`;
      })();

  const head = toRight
    ? `${tipX},${to.y} ${tipX + 6},${to.y - 3.5} ${tipX + 6},${to.y + 3.5}`
    : `${tipX},${to.y} ${tipX - 6},${to.y - 3.5} ${tipX - 6},${to.y + 3.5}`;

  return { d, head };
}

/** Ô chú thích nhỏ ở thanh công cụ. */
function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {swatch}
      {label}
    </span>
  );
}

export function GanttPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const canManagePlan = useAuth((s) => s.can('plan:manage'));

  const { data: project, isLoading: lp, isError: pe, error: pErr, refetch: refetchProject } = useProject(key);
  const projectId = project?.id;
  const issuesQ = useProjectIssues(projectId);
  const { data: issues, isLoading: li } = issuesQ;
  const isLoading = lp || li;

  const scheduleQ = useSchedule(projectId);
  const depsQ = useDependencies(projectId);
  const milestonesQ = useMilestones(projectId);
  const baselinesQ = useBaselines(projectId);

  const [showCritical, setShowCritical] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [baselineId, setBaselineId] = useState('');
  const baselineQ = useBaseline(projectId, baselineId || undefined);
  const createBaseline = useCreateBaseline(projectId ?? '');

  const compareOn = !!baselineId;
  const milestones = useMemo<MilestoneDto[]>(() => milestonesQ.data ?? [], [milestonesQ.data]);
  const deps = useMemo<DependencyDto[]>(() => depsQ.data ?? [], [depsQ.data]);

  const scheduleById = useMemo(
    () => new Map<string, ScheduleItemDto>((scheduleQ.data?.items ?? []).map((i) => [i.id, i])),
    [scheduleQ.data],
  );
  const baselineById = useMemo(
    () => new Map<string, BaselineItemDto>((baselineQ.data?.items ?? []).map((i) => [i.issueId, i])),
    [baselineQ.data],
  );

  const model = useMemo(() => {
    const today = startOfDay(new Date());
    const spans: Span[] = [];
    let noDate = 0;

    for (const issue of issues ?? []) {
      const sch = scheduleById.get(issue.id);
      let start: Date;
      let end: Date;
      let inferred = false;

      if (issue.startDate || issue.dueDate) {
        start = startOfDay(new Date(issue.startDate ?? issue.dueDate ?? issue.createdAt));
        const rawEnd = startOfDay(new Date(issue.dueDate ?? issue.startDate ?? issue.createdAt));
        end = rawEnd < start ? start : rawEnd;
      } else if (sch) {
        start = startOfDay(new Date(sch.earlyStart));
        end = startOfDay(new Date(sch.earlyFinish));
        inferred = true;
      } else {
        noDate++;
        continue;
      }

      const base = compareOn ? baselineById.get(issue.id) : undefined;
      const bStartRaw = base?.startDate ? startOfDay(new Date(base.startDate)) : null;
      const bEndRaw = base?.dueDate ? startOfDay(new Date(base.dueDate)) : null;
      const baseStart = bStartRaw ?? bEndRaw;
      const baseEndPick = bEndRaw ?? bStartRaw;
      const baseEnd = baseStart && baseEndPick && baseEndPick < baseStart ? baseStart : baseEndPick;

      spans.push({
        issue,
        start,
        end,
        overdue: isOverdue(issue),
        inferred,
        critical: sch?.isCritical ?? false,
        slackDays: sch?.slackDays ?? null,
        baseStart,
        baseEnd,
      });
    }

    spans.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());

    const empty = {
      spans, days: [] as Date[], months: [] as { label: string; span: number }[],
      minD: today, totalDays: 0, today, noDate,
      layout: new Map<string, BarBox>(), msPoints: [] as { m: MilestoneDto; x: number }[],
    };
    if (spans.length === 0) return empty;

    const times = spans.flatMap((s) => {
      const t = [s.start.getTime(), s.end.getTime()];
      if (s.baseStart) t.push(s.baseStart.getTime());
      if (s.baseEnd) t.push(s.baseEnd.getTime());
      return t;
    });
    times.push(today.getTime());
    for (const m of milestones) times.push(startOfDay(new Date(m.dueDate)).getTime());

    const minD = addDays(startOfDay(new Date(Math.min(...times))), -2);
    let maxD = addDays(startOfDay(new Date(Math.max(...times))), 7);
    let totalDays = differenceInCalendarDays(maxD, minD) + 1;
    if (totalDays > MAX_DAYS) {
      maxD = addDays(minD, MAX_DAYS - 1);
      totalDays = MAX_DAYS;
    }
    const days = Array.from({ length: totalDays }, (_, i) => addDays(minD, i));

    // Gộp ngày theo tháng để vẽ dải tháng ở header.
    const months: { label: string; span: number }[] = [];
    let i = 0;
    while (i < days.length) {
      const m = days[i];
      let j = i;
      while (j < days.length && days[j].getMonth() === m.getMonth() && days[j].getFullYear() === m.getFullYear()) j++;
      months.push({ label: format(m, 'MM/yyyy'), span: j - i });
      i = j;
    }

    const dayOffset = (d: Date) => differenceInCalendarDays(d, minD);
    const layout = new Map<string, BarBox>();
    spans.forEach((s, row) => {
      const left = dayOffset(s.start) * DAY_W;
      const width = Math.max((dayOffset(s.end) - dayOffset(s.start) + 1) * DAY_W - 4, DAY_W - 4);
      layout.set(s.issue.id, { row, left, right: left + width, y: row * ROW_STRIDE + ROW_H / 2 });
    });

    const msPoints = milestones.map((m) => ({
      m,
      x: dayOffset(startOfDay(new Date(m.dueDate))) * DAY_W + DAY_W / 2,
    }));

    return { spans, days, months, minD, totalDays, today, noDate, layout, msPoints };
  }, [issues, scheduleById, baselineById, milestones, compareOn]);

  const trackW = model.totalDays * DAY_W;
  const offset = (d: Date) => differenceInCalendarDays(d, model.minD);
  const criticalCount = scheduleQ.data?.criticalCount ?? 0;
  const hasInferred = model.spans.some((s) => s.inferred);
  const highlightCritical = showCritical && deps.length > 0;

  const baselineOptions = useMemo(
    () => [
      { value: '', label: 'Không so sánh' },
      ...(baselinesQ.data ?? []).map((b) => ({
        value: b.id,
        label: b.name,
        hint: format(new Date(b.capturedAt), 'dd/MM/yy'),
      })),
    ],
    [baselinesQ.data],
  );

  async function captureBaseline() {
    if (!projectId) return;
    const name = `Kế hoạch gốc ${format(new Date(), 'dd/MM/yyyy HH:mm')}`;
    try {
      const created = await createBaseline.mutateAsync({ name });
      setBaselineId(created.id);
      toast.success(`Đã chụp “${name}” — đang so sánh với kế hoạch hiện tại`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  function barTitle(s: Span): string {
    const parts = [`${s.issue.key} · ${format(s.start, 'dd/MM')} → ${format(s.end, 'dd/MM')}`];
    if (s.inferred) parts.push('Ngày dự kiến (suy từ phụ thuộc)');
    if (s.overdue) parts.push('Quá hạn');
    if (highlightCritical && s.critical) parts.push('Đường găng · dự trữ 0 ngày');
    else if (s.slackDays !== null && s.slackDays > 0) parts.push(`Dự trữ ${s.slackDays} ngày`);
    if (compareOn && s.baseStart && s.baseEnd) {
      const delta = differenceInCalendarDays(s.end, s.baseEnd);
      const drift = delta === 0 ? 'đúng kế hoạch' : `lệch ${delta > 0 ? '+' : ''}${delta} ngày`;
      parts.push(`Kế hoạch gốc: ${format(s.baseStart, 'dd/MM')} → ${format(s.baseEnd, 'dd/MM')} (${drift})`);
    }
    return parts.join(' · ');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border px-4 py-2">
        <Button
          variant={highlightCritical ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={highlightCritical}
          disabled={deps.length === 0}
          title={deps.length === 0 ? 'Cần ít nhất một phụ thuộc để tính đường găng' : 'Bật/tắt tô đường găng'}
          onClick={() => setShowCritical((v) => !v)}
        >
          <Zap className="h-4 w-4" aria-hidden /> Đường găng
          {deps.length > 0 && <span className="tabular text-muted">{criticalCount}</span>}
        </Button>

        <Button variant="ghost" size="sm" disabled={!projectId} onClick={() => setPanelOpen(true)}>
          <Link2 className="h-4 w-4" aria-hidden /> Phụ thuộc &amp; cột mốc
          <span className="tabular text-muted">{deps.length + milestones.length}</span>
        </Button>

        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted" htmlFor="gantt-baseline">Kế hoạch gốc</label>
          <SearchSelect
            id="gantt-baseline"
            disabled={!projectId || (baselinesQ.data?.length ?? 0) === 0}
            value={baselineId}
            onChange={setBaselineId}
            options={baselineOptions}
            placeholder="Không so sánh"
            searchPlaceholder="Tìm kế hoạch gốc…"
            ariaLabel="Chọn kế hoạch gốc để so sánh"
            className="h-8 w-48 text-sm"
          />
        </div>

        {canManagePlan && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void captureBaseline()}
            loading={createBaseline.isPending}
            disabled={!projectId || createBaseline.isPending}
            title="Lưu ảnh chụp ngày bắt đầu/hạn hiện tại của mọi issue"
          >
            <Camera className="h-4 w-4" aria-hidden /> Chụp kế hoạch gốc
          </Button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {highlightCritical && (
            <LegendItem
              label="Đường găng"
              swatch={
                <span
                  className="h-2.5 w-5 rounded-sm bg-surface-3"
                  style={{ boxShadow: '0 0 0 1.5px var(--danger)' }}
                  aria-hidden
                />
              }
            />
          )}
          {compareOn && (
            <LegendItem
              label="Kế hoạch gốc"
              swatch={<span className="h-2.5 w-5 rounded-sm border border-dashed border-[var(--border-strong)]" aria-hidden />}
            />
          )}
          {hasInferred && (
            <LegendItem
              label="Ngày dự kiến"
              swatch={<span className="h-2.5 w-5 rounded-sm border border-dashed border-[var(--faint)] opacity-70" aria-hidden />}
            />
          )}
          {milestones.length > 0 && (
            <LegendItem
              label="Cột mốc"
              swatch={<span className="h-2 w-2 rotate-45 bg-primary" aria-hidden />}
            />
          )}
        </div>
      </div>

      {model.noDate > 0 && (
        <div className="border-b border-border px-6 py-2 text-xs text-faint">
          {model.noDate} issue chưa có ngày bắt đầu/hạn và không nằm trong chuỗi phụ thuộc nào
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {pe || issuesQ.isError ? (
          <QueryError
            error={pErr ?? issuesQ.error}
            onRetry={() => { void refetchProject(); void issuesQ.refetch(); }}
          />
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
            <DelayedSpinner />
          </div>
        ) : model.spans.length === 0 ? (
          <EmptyState
            icon={<CalendarRange className="h-8 w-8" aria-hidden />}
            title="Chưa có issue nào có ngày"
            description="Đặt ngày bắt đầu hoặc hạn chót cho issue để chúng xuất hiện trên lịch trình."
          />
        ) : (
          <div className="inline-block min-w-full overflow-hidden rounded-lg border border-border bg-surface">
            <div style={{ width: LABEL_W + trackW }}>
              {/* Header: dải tháng + số ngày */}
              <div className="sticky top-0 z-20 flex border-b border-border bg-surface">
                <div
                  className="sticky left-0 z-10 shrink-0 border-r border-border bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wide text-faint"
                  style={{ width: LABEL_W }}
                >
                  Issue
                </div>
                <div style={{ width: trackW }}>
                  <div className="flex">
                    {model.months.map((m, i) => (
                      <div
                        key={i}
                        className="border-r border-border py-1 text-center text-xs font-medium text-muted"
                        style={{ width: m.span * DAY_W }}
                      >
                        {m.label}
                      </div>
                    ))}
                  </div>
                  <div className="flex border-t border-border">
                    {model.days.map((d, i) => {
                      const weekend = d.getDay() === 0 || d.getDay() === 6;
                      const isToday = offset(d) === offset(model.today);
                      return (
                        <div
                          key={i}
                          className={cn(
                            'shrink-0 py-1 text-center text-[10px] tabular',
                            weekend ? 'bg-surface-2 text-faint' : 'text-muted',
                            isToday && 'bg-primary-subtle font-semibold text-primary',
                          )}
                          style={{ width: DAY_W }}
                        >
                          {d.getDate()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Làn cột mốc */}
              {model.msPoints.length > 0 && (
                <div className="flex border-b border-border">
                  <div
                    className="sticky left-0 z-10 shrink-0 border-r border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted"
                    style={{ width: LABEL_W }}
                  >
                    Cột mốc
                  </div>
                  <div className="relative" style={{ width: trackW, height: 30 }}>
                    {model.msPoints.map(({ m, x }) => {
                      const color = m.color ?? 'var(--primary)';
                      return (
                        <div
                          key={m.id}
                          className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5"
                          style={{ left: x }}
                          title={`${m.name} · ${format(new Date(m.dueDate), 'dd/MM/yyyy')}${m.completedAt ? ' · Đã hoàn thành' : ''}`}
                        >
                          <span
                            className={cn('-ml-[5px] h-2.5 w-2.5 shrink-0 rotate-45 border', m.completedAt && 'opacity-60')}
                            style={{ background: m.completedAt ? 'transparent' : color, borderColor: color }}
                            aria-hidden
                          />
                          <span className={cn('whitespace-nowrap text-[11px] font-medium text-ink', m.completedAt && 'text-muted line-through')}>
                            {m.name}
                          </span>
                          <span className="whitespace-nowrap text-[11px] tabular text-faint">
                            {format(new Date(m.dueDate), 'dd/MM')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Body: mỗi issue 1 hàng + thanh thời gian */}
              <div className="relative">
                {/* Đường "hôm nay" xuyên suốt */}
                <div
                  className="pointer-events-none absolute bottom-0 top-0 z-0 w-px bg-primary/60"
                  style={{ left: LABEL_W + offset(model.today) * DAY_W + DAY_W / 2 }}
                  aria-hidden
                />
                {/* Vạch dọc cho từng cột mốc */}
                {model.msPoints.map(({ m, x }) => (
                  <div
                    key={m.id}
                    className="pointer-events-none absolute bottom-0 top-0 z-0 w-0 border-l border-dashed opacity-50"
                    style={{ left: LABEL_W + x, borderColor: m.color ?? 'var(--primary)' }}
                    aria-hidden
                  />
                ))}

                {/* Mũi tên phụ thuộc */}
                {deps.length > 0 && (
                  <svg
                    className="pointer-events-none absolute left-0 top-0 z-[5]"
                    width={LABEL_W + trackW}
                    height={model.spans.length * ROW_STRIDE}
                    aria-hidden
                  >
                    <g transform={`translate(${LABEL_W},0)`}>
                      {deps.map((dep) => {
                        const from = model.layout.get(dep.predecessorId);
                        const to = model.layout.get(dep.successorId);
                        if (!from || !to) return null;
                        const critical =
                          highlightCritical &&
                          (scheduleById.get(dep.predecessorId)?.isCritical ?? false) &&
                          (scheduleById.get(dep.successorId)?.isCritical ?? false);
                        const color = critical ? 'var(--danger)' : 'var(--border-strong)';
                        const { d, head } = dependencyPath(dep, from, to);
                        return (
                          <g key={dep.id} opacity={critical ? 0.95 : 0.7}>
                            <path d={d} fill="none" stroke={color} strokeWidth={critical ? 1.6 : 1.2} />
                            <polygon points={head} fill={color} />
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                )}

                {model.spans.map((s) => {
                  const { issue, start, end, overdue, inferred, critical } = s;
                  const box = model.layout.get(issue.id);
                  const left = box?.left ?? 0;
                  const width = (box?.right ?? 0) - left;
                  const barColor = overdue
                    ? 'var(--danger)'
                    : issue.status.color || categoryColor(issue.status.category);
                  const isCritical = highlightCritical && critical;
                  const baseLeft = s.baseStart ? offset(s.baseStart) * DAY_W : 0;
                  const baseWidth =
                    s.baseStart && s.baseEnd
                      ? Math.max((offset(s.baseEnd) - offset(s.baseStart) + 1) * DAY_W - 4, DAY_W - 4)
                      : 0;
                  return (
                    <div key={issue.id} className="flex border-b border-border last:border-b-0 hover:bg-surface-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/issue/${issue.key}`)}
                        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-border bg-surface px-3 text-left hover:bg-surface-2"
                        style={{ width: LABEL_W, height: ROW_H }}
                      >
                        {isCritical && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" title="Trên đường găng" aria-hidden />
                        )}
                        <span className="shrink-0 font-mono text-xs text-muted">{issue.key}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{issue.summary}</span>
                      </button>
                      <div className="relative" style={{ width: trackW, height: ROW_H }}>
                        {compareOn && baseWidth > 0 && (
                          <div
                            className="absolute top-1/2 -translate-y-1/2 rounded-md border border-dashed"
                            style={{
                              left: baseLeft,
                              width: baseWidth,
                              height: ROW_H - 6,
                              borderColor: 'var(--border-strong)',
                              background: 'color-mix(in oklch, var(--muted) 10%, transparent)',
                            }}
                            aria-hidden
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => navigate(`/issue/${issue.key}`)}
                          title={barTitle(s)}
                          className={cn(
                            'absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-md border px-2 text-left',
                            'transition-opacity hover:opacity-90',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                            inferred && 'border-dashed opacity-75',
                          )}
                          style={{
                            left,
                            width,
                            height: ROW_H - 14,
                            background: inferred
                              ? 'transparent'
                              : `color-mix(in oklch, ${barColor} 34%, var(--surface))`,
                            borderColor: `color-mix(in oklch, ${barColor} 60%, var(--surface))`,
                            boxShadow: isCritical ? '0 0 0 1.5px var(--danger)' : undefined,
                          }}
                        >
                          {width >= 70 && (
                            <span
                              className="truncate text-[11px] font-medium"
                              style={{ color: overdue ? 'var(--danger)' : 'var(--ink)' }}
                            >
                              {inferred ? 'Dự kiến · ' : ''}
                              {overdue ? 'Quá hạn · ' : ''}
                              {issue.summary}
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {projectId && (
        <PlanningPanel
          open={panelOpen}
          projectId={projectId}
          issues={issues ?? []}
          canManage={canManagePlan}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}
