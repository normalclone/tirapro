import type { IssueDto } from '@tirapro/types';
import { categoryColor } from '@/lib/statusColor';
import { cn } from '@/lib/utils';

/**
 * Chip TRẠNG THÁI: nền + chữ + chấm cùng tông màu của nhóm (To Do / In Progress / Done) để nhìn từ xa vẫn phân biệt được —
 * chỉ một chấm nhỏ trên nền xám thì cả cột trông như một màu. Chữ trộn màu nhóm với `--ink-strong` để đủ tương phản (AA)
 * ở cả sáng lẫn tối. Tên ẩn dưới `md` (chấm vẫn có tooltip).
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
  const color = categoryColor(status.category);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
      style={{
        background: `color-mix(in oklch, ${color} 16%, var(--surface))`,
        color: `color-mix(in oklch, ${color} 70%, var(--ink-strong))`,
      }}
      title={`Trạng thái: ${status.name}`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span
        className={cn(
          alwaysShowName ? 'max-w-[12rem]' : 'hidden max-w-[7rem] md:inline',
          'truncate',
        )}
      >
        {status.name}
      </span>
      {!alwaysShowName && <span className="sr-only md:hidden">{status.name}</span>}
    </span>
  );
}
