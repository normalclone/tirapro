import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import { CalendarRange } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import { useProjectIssues } from '@/features/backlog/api';
import { DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { isOverdue } from '@/components/ui/DueBadge';
import { categoryColor } from '@/lib/statusColor';
import { cn } from '@/lib/utils';

const LABEL_W = 240;
const DAY_W = 30;
const ROW_H = 40;
const MAX_DAYS = 220;

interface Span {
  issue: IssueDto;
  start: Date;
  end: Date;
  overdue: boolean;
}

export function GanttPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: lp, isError: pe, error: pErr, refetch: refetchProject } = useProject(key);
  const issuesQ = useProjectIssues(project?.id);
  const { data: issues, isLoading: li } = issuesQ;
  const isLoading = lp || li;

  const model = useMemo(() => {
    const today = startOfDay(new Date());
    const dated = (issues ?? []).filter((i) => i.dueDate || i.startDate);
    const spans: Span[] = dated
      .map((i) => {
        const start = startOfDay(new Date(i.startDate ?? i.dueDate ?? i.createdAt));
        const rawEnd = startOfDay(new Date(i.dueDate ?? i.startDate ?? i.createdAt));
        const end = rawEnd < start ? start : rawEnd;
        return { issue: i, start, end, overdue: isOverdue(i) };
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());

    const noDate = (issues ?? []).length - dated.length;
    if (spans.length === 0) return { spans, days: [], months: [], minD: today, totalDays: 0, today, noDate };

    const times = spans.flatMap((s) => [s.start.getTime(), s.end.getTime()]).concat(today.getTime());
    let minD = addDays(startOfDay(new Date(Math.min(...times))), -2);
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
    return { spans, days, months, minD, totalDays, today, noDate };
  }, [issues]);

  const trackW = model.totalDays * DAY_W;
  const offset = (d: Date) => differenceInCalendarDays(d, model.minD);

  return (
    <div className="flex h-full flex-col">
      {model.noDate > 0 && (
        <div className="border-b border-border px-6 py-2 text-xs text-faint">
          {model.noDate} issue chưa có ngày bắt đầu/hạn
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

              {/* Body: mỗi issue 1 hàng + thanh thời gian */}
              <div className="relative">
                {/* Đường "hôm nay" xuyên suốt */}
                <div
                  className="pointer-events-none absolute bottom-0 top-0 z-0 w-px bg-primary/60"
                  style={{ left: LABEL_W + offset(model.today) * DAY_W + DAY_W / 2 }}
                  aria-hidden
                />
                {model.spans.map(({ issue, start, end, overdue }) => {
                  const left = offset(start) * DAY_W;
                  const width = (offset(end) - offset(start) + 1) * DAY_W;
                  const barColor = overdue
                    ? 'var(--danger)'
                    : issue.status.color || categoryColor(issue.status.category);
                  return (
                    <div key={issue.id} className="flex border-b border-border last:border-b-0 hover:bg-surface-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/issue/${issue.key}`)}
                        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-border bg-surface px-3 text-left hover:bg-surface-2"
                        style={{ width: LABEL_W, height: ROW_H }}
                      >
                        <span className="shrink-0 font-mono text-xs text-muted">{issue.key}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{issue.summary}</span>
                      </button>
                      <div className="relative" style={{ width: trackW, height: ROW_H }}>
                        <button
                          type="button"
                          onClick={() => navigate(`/issue/${issue.key}`)}
                          title={`${issue.key} · ${format(start, 'dd/MM')} → ${format(end, 'dd/MM')}${overdue ? ' · Quá hạn' : ''}`}
                          className={cn(
                            'absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-md border px-2 text-left',
                            'transition-opacity hover:opacity-90',
                          )}
                          style={{
                            left,
                            width: Math.max(width - 4, DAY_W - 4),
                            height: ROW_H - 14,
                            background: `color-mix(in oklch, ${barColor} 34%, var(--surface))`,
                            borderColor: `color-mix(in oklch, ${barColor} 60%, var(--surface))`,
                          }}
                        >
                          {width >= 70 && (
                            <span
                              className="truncate text-[11px] font-medium"
                              style={{ color: overdue ? 'var(--danger)' : 'var(--ink)' }}
                            >
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
    </div>
  );
}
