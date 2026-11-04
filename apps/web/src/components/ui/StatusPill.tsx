import type { IssueDto } from '@tirapro/types';
import { categoryColor } from '@/lib/statusColor';
import { cn } from '@/lib/utils';

/**
 * Chip TRẠNG THÁI: chấm theo nhóm (To Do / In Progress / Done) + tên (ẩn tên dưới `md`, chấm vẫn có tooltip).
 * `alwaysShowName`: danh sách mà trạng thái là thông tin chính ("Việc của tôi") — luôn hiện tên, mọi cỡ màn hình.
 */
export function StatusPill({
  status,
  className,
  alwaysShowName,
}: {
  status: Pick<IssueDto['status'], 'name' | 'category'>;
  className?: string;
  alwaysShowName?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted',
        className,
      )}
      title={`Trạng thái: ${status.name}`}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: categoryColor(status.category) }}
        aria-hidden
      />
      <span className={cn('max-w-[7rem] truncate', !alwaysShowName && 'hidden md:inline')}>
        {status.name}
      </span>
      {!alwaysShowName && <span className="sr-only md:hidden">{status.name}</span>}
    </span>
  );
}
