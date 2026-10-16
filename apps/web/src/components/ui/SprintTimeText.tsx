import type { SprintDto } from '@tirapro/types';
import { cn } from '@/lib/utils';
import { SPRINT_TONE_CLASS, sprintTimeInfo } from '@/lib/sprintTime';

/**
 * "· 15/10 – 29/10 · còn 14 ngày" — khoảng ngày + đếm ngược của sprint, nhãn đổi màu khi sắp/đã trễ.
 * Khoảng ngày ẩn ở màn hẹp (nhãn đếm ngược luôn hiện).
 */
export function SprintTimeText({
  sprint,
  className,
}: {
  sprint: Pick<SprintDto, 'state' | 'startDate' | 'endDate'>;
  className?: string;
}) {
  const info = sprintTimeInfo(sprint);
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap', className)}>
      {info.range && <span className="hidden text-muted sm:inline">· {info.range}</span>}
      <span className={SPRINT_TONE_CLASS[info.tone]}>· {info.label}</span>
    </span>
  );
}
