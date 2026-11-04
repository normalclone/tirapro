import { SearchSelect } from '@/components/ui/SearchSelect';
import { categoryColor } from '@/lib/statusColor';
import type { NextStatus } from './nextStatuses';

/**
 * Việc đang ở trạng thái của quy trình KHÁC với quy trình của loại việc (dữ liệu lệch): không có bước nào xuất phát từ
 * trạng thái đó, nên thay dãy nút bằng MỘT ô chọn trạng thái trong quy trình đúng — máy chủ cho chuyển thẳng.
 */
export function RepairStatusPicker({
  statuses,
  workflowName,
  disabled,
  onPick,
  className,
}: {
  statuses: readonly NextStatus[];
  workflowName: string | null;
  disabled?: boolean;
  onPick: (statusId: string) => void;
  className?: string;
}) {
  return (
    <SearchSelect
      value=""
      onChange={(v) => v && onPick(v)}
      options={statuses.map((s) => ({
        value: s.id,
        label: s.name,
        color: categoryColor(s.category),
      }))}
      placeholder="Chuyển về quy trình đúng…"
      searchPlaceholder="Tìm trạng thái…"
      ariaLabel="Chuyển về quy trình đúng"
      disabled={disabled}
      className={
        className ??
        'h-8 w-auto border-warning/60 bg-warning/10 px-2.5 text-sm [@media(pointer:coarse)]:h-11'
      }
      renderTrigger={() => (
        <span
          title={`Trạng thái hiện tại không thuộc quy trình${workflowName ? ` “${workflowName}”` : ''} của loại việc này — chọn trạng thái trong quy trình đúng`}
        >
          Chuyển về quy trình đúng…
        </span>
      )}
    />
  );
}
