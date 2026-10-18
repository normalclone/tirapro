import { AlertTriangle, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calendarDate } from '@/lib/calendarDate';
import { fmtDayMonth } from '@/lib/dateFormat';
import { dueDaysFromToday, dueState, type DueLike } from '@/lib/dueDate';

/**
 * Class viền cảnh báo (toàn bộ viền, KHÔNG side-stripe) cho task sắp/đã quá hạn:
 * đỏ khi quá hạn, hổ phách khi sắp đến hạn, rỗng khi bình thường.
 * Dùng cùng `cn('border', dueBorderClass(issue) || 'border-border', …)`.
 */
export function dueBorderClass(issue: DueLike): string {
  const st = dueState(issue);
  if (st === 'overdue') return 'border-danger';
  if (st === 'soon') return 'border-warning';
  return '';
}

function dueLabel(iso: string): string {
  return fmtDayMonth(calendarDate(iso));
}

/**
 * Nhãn hạn chót với cảnh báo: đỏ "Quá hạn" khi trễ, hổ phách khi sắp đến hạn,
 * mờ khi còn xa. Không render nếu issue không có dueDate.
 */
export function DueBadge({
  issue,
  className,
  warnOnly,
}: {
  issue: DueLike;
  className?: string;
  /** Chỉ hiện khi quá hạn / sắp đến hạn (cho bề mặt dày như card, dòng list). */
  warnOnly?: boolean;
}) {
  const st = dueState(issue);
  if (!st || !issue.dueDate) return null;
  if (warnOnly && st === 'normal') return null;

  if (st === 'overdue') {
    const late = Math.abs(dueDaysFromToday(issue.dueDate));
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
          'bg-danger/10 text-danger',
          className,
        )}
        title={`Quá hạn ${late} ngày (hạn ${dueLabel(issue.dueDate)})`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Quá hạn{late > 0 ? ` ${late}n` : ''}
      </span>
    );
  }

  const tone = st === 'soon' ? 'text-warning' : 'text-muted';
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs font-medium', tone, className)}
      title={
        st === 'soon'
          ? `Sắp đến hạn (${dueLabel(issue.dueDate)})`
          : `Hạn ${dueLabel(issue.dueDate)}`
      }
    >
      <CalendarClock className="h-3 w-3" aria-hidden />
      {dueLabel(issue.dueDate)}
    </span>
  );
}
