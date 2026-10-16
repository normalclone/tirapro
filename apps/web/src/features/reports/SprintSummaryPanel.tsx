import { useState } from 'react';
import { ChevronDown, ListTodo } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { SprintSummaryReport } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { TERM } from '@/lib/terms';
import { cn } from '@/lib/utils';
import { completionPct, fmtPoints, movedToLabel, velocityVerdict } from './sprintSummary';

const TONE_CLASS = {
  good: 'text-status-done',
  warn: 'text-warning-ink',
  neutral: 'text-muted',
} as const;

/**
 * Tổng kết của một sprint ĐÃ KẾT THÚC: x/y điểm, so với velocity TB, việc chuyển tiếp và nơi chúng được chuyển
 * tới. Chỉ đọc. Thu gọn được (đầu trang tab Sprint, người đã đọc rồi không phải cuộn qua mỗi lần).
 */
export function SprintSummaryPanel({
  summary,
  projectKey,
}: {
  summary: SprintSummaryReport;
  projectKey: string;
}) {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const { committed, completed, remaining, initialCommitted, carriedOver, movedTo, sprint } =
    summary;
  const verdict = velocityVerdict(summary.velocity.deltaPct);
  const destination = movedToLabel(movedTo);
  const scopeChanged =
    !!initialCommitted &&
    (initialCommitted.points !== committed.points || initialCommitted.count !== committed.count);

  return (
    <section
      aria-label={`Tổng kết ${sprint.name}`}
      className="print-avoid-break rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="sprint-summary-body"
          onClick={() => setOpen((o) => !o)}
          className="-ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-ink-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <ChevronDown
            className={cn('h-4 w-4 text-muted transition-transform', !open && '-rotate-90')}
            aria-hidden
          />
          Tổng kết {sprint.name}
        </button>
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => navigate(`/p/${projectKey}/backlog`)}
        >
          <ListTodo className="h-4 w-4" aria-hidden />
          Về {TERM.backlog}
        </Button>
      </div>

      {open && (
        <div id="sprint-summary-body" className="mt-3 space-y-3">
          <div>
            <p className="text-lg font-semibold tabular text-ink-strong">
              Hoàn thành {fmtPoints(completed.points)}/{fmtPoints(committed.points)} điểm (
              {completionPct(completed.points, committed.points)}%) · {completed.count}/
              {committed.count} việc
            </p>
            <p className={cn('mt-0.5 text-sm', TONE_CLASS[verdict.tone])}>
              {verdict.text}
              {summary.velocity.sprintsCounted > 0 && (
                <span className="text-muted">
                  {' '}
                  ({fmtPoints(summary.velocity.average)} điểm, trung bình{' '}
                  {summary.velocity.sprintsCounted} sprint trước)
                </span>
              )}
            </p>
            {scopeChanged && (
              <p className="mt-0.5 text-xs text-muted">
                Cam kết lúc bắt đầu {fmtPoints(initialCommitted.points)} điểm ·{' '}
                {initialCommitted.count} việc; phạm vi đã đổi trong sprint.
              </p>
            )}
          </div>

          <CarryOver
            carriedOver={carriedOver}
            destination={destination}
            hasUnrecorded={remaining.count > 0 && carriedOver.length === 0}
          />
        </div>
      )}
    </section>
  );
}

function CarryOver({
  carriedOver,
  destination,
  hasUnrecorded,
}: {
  carriedOver: SprintSummaryReport['carriedOver'];
  destination: string | null;
  hasUnrecorded: boolean;
}) {
  if (carriedOver.length > 0) {
    return (
      <div>
        <h3 className="text-sm font-medium text-ink-strong">
          Chuyển tiếp {carriedOver.length} việc{destination ? ` → ${destination}` : ''}
        </h3>
        <ul className="mt-1.5 divide-y divide-border rounded-md border border-border">
          {carriedOver.map((i) => (
            <li key={i.id}>
              <Link
                to={`/issue/${i.key}`}
                className="flex items-baseline gap-2 px-3 py-1.5 text-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
              >
                <span className="shrink-0 font-mono text-xs text-muted">{i.key}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{i.summary}</span>
                <span className="shrink-0 text-xs tabular text-muted">
                  {i.storyPoints == null ? '—' : `${fmtPoints(i.storyPoints)} điểm`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (hasUnrecorded) {
    return <p className="text-sm text-muted">Chưa lưu danh sách chuyển tiếp cho sprint này.</p>;
  }
  return <p className="text-sm text-muted">Hoàn thành toàn bộ cam kết.</p>;
}
