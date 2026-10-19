import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { peekAriaLabel, peekCountText, type PeekPosition } from '@/lib/peekPosition';

/**
 * ‹ "3/25" › trong đầu panel xem nhanh. Cùng thứ tự và cùng luật với `j`/`k`: kẹp ở hai đầu, KHÔNG vòng — nên nút ở đầu/cuối là
 * vô hiệu. Vô hiệu bằng `aria-disabled` (không phải `disabled`) để focus không rơi mất khi bấm tới cuối; lệnh bị chặn ở `onStep`.
 * `position` null (thứ tự không biết) → không vẽ gì, thay vì hiện nút vô hiệu. "n/N" chỉ hiện khi tổng đáng tin (danh sách
 * ảo hoá một phần chỉ có cửa sổ trong DOM → ẩn). Tên truy cập "Việc 3 trên 25" chỉ cho trình đọc màn hình (số nhìn thấy `aria-hidden`),
 * vùng `role="status"` báo mỗi khi sang việc khác.
 */
export function PeekNavControls({
  position,
  onStep,
  busyNext = false,
}: {
  position: PeekPosition | null;
  onStep: (dir: 1 | -1) => void;
  /** "Việc sau" đang nạp thêm kết quả: `aria-busy` + biểu tượng quay, bấm thêm không làm gì (nhưng vẫn là nút, giữ focus). */
  busyNext?: boolean;
}) {
  if (!position) return null;
  const step = (dir: 1 | -1, enabled: boolean) => () => {
    if (enabled) onStep(dir);
  };
  const cls =
    'aria-disabled:cursor-not-allowed aria-disabled:text-disabled-fg aria-disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none';
  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Việc trước"
        aria-keyshortcuts="k"
        aria-disabled={position.hasPrev ? undefined : true}
        title="Việc trước (K)"
        onClick={step(-1, position.hasPrev)}
        className={cls}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Button>
      {position.countKnown && (
        <span role="status" className="tabular min-w-[3ch] px-0.5 text-center text-xs text-muted">
          <span aria-hidden>{peekCountText(position)}</span>
          <span className="sr-only">{peekAriaLabel(position)}</span>
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Việc sau"
        aria-keyshortcuts="j"
        aria-disabled={position.hasNext ? undefined : true}
        aria-busy={busyNext || undefined}
        title="Việc sau (J)"
        onClick={step(1, position.hasNext && !busyNext)}
        className={cls}
      >
        {busyNext ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}
