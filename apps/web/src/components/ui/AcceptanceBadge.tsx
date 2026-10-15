import { CheckSquare } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { cn } from '@/lib/utils';

/** Huy hiệu "x/y đạt" của Tiêu chí chấp nhận (thẻ board, dòng Việc chờ). Ẩn khi không có tiêu chí nào. */
export function AcceptanceBadge({
  progress,
  className,
}: {
  progress: IssueDto['acceptanceProgress'] | undefined;
  className?: string;
}) {
  if (!progress || progress.total === 0) return null;
  const { done, total } = progress;
  const label = `Tiêu chí chấp nhận: đạt ${done}/${total}`;
  return (
    <span
      className={cn(
        'tabular inline-flex shrink-0 items-center gap-1 text-[10px] font-medium',
        done === total ? 'text-success' : 'text-muted',
        className,
      )}
      role="img"
      title={label}
      aria-label={label}
    >
      <CheckSquare className="h-3 w-3" aria-hidden />
      {done}/{total}
    </span>
  );
}
