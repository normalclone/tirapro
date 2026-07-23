import { differenceInCalendarDays } from 'date-fns';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';

type DueLike = { dueDate: string | null; status?: { category?: string } | null };

/** Issue quá hạn: có dueDate, chưa Done, và dueDate đã ở quá khứ. */
export function isOverdue(issue: DueLike): boolean {
  if (!issue.dueDate || issue.status?.category === 'DONE') return false;
  return differenceInCalendarDays(new Date(issue.dueDate), new Date()) < 0;
}

export type DueState = 'overdue' | 'soon' | 'normal';

/** Phân loại hạn: quá hạn / sắp đến hạn (≤2 ngày) / bình thường. null nếu không có hạn. */
export function dueState(issue: DueLike): DueState | null {
  if (!issue.dueDate) return null;
  const done = issue.status?.category === 'DONE';
  const days = differenceInCalendarDays(new Date(issue.dueDate), new Date());
  if (!done && days < 0) return 'overdue';
  if (!done && days <= 2) return 'soon';
  return 'normal';
}

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

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
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
    const late = Math.abs(differenceInCalendarDays(new Date(issue.dueDate), new Date()));
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
          'bg-danger/10 text-danger',
          className,
        )}
        title={`Quá hạn ${late} ngày (hạn ${shortDate(issue.dueDate)})`}
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
      title={st === 'soon' ? `Sắp đến hạn (${shortDate(issue.dueDate)})` : `Hạn ${shortDate(issue.dueDate)}`}
    >
      <CalendarClock className="h-3 w-3" aria-hidden />
      {shortDate(issue.dueDate)}
    </span>
  );
}
