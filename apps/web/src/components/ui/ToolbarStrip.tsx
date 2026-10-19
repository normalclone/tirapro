import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { MOBILE_SCROLL_STRIP } from '@/lib/touchHit';
import { useScrollFade } from '@/lib/useScrollFade';

/**
 * Gom các điều khiển phụ của thanh công cụ (Board, Việc chờ) thành MỘT dòng cuộn ngang dưới `sm` — cùng kiểu với
 * hàng chip lọc nhanh (`QuickFilterChips`): không xuống dòng, ẩn thanh cuộn, mờ mép báo còn mục, tràn sát mép
 * màn hình (`-mx-4` bù lề `px-4` của thanh chứa). Từ `sm` trở lên là `display: contents` nên các con quay về làm con
 * trực tiếp của thanh chứa — bố cục desktop giữ nguyên.
 * Con của dải (kể cả con của một khung `contents` ngay trong dải) không tự co (`shrink-0`); nút cần ≥ 44px chiều bấm thì dùng `CHIP_TOUCH_HIT` (đệm dọc của dải chứa vùng mở rộng).
 */
export function ToolbarStrip({
  children,
  className,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const { ref, style } = useScrollFade<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={style}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'flex items-center gap-2 sm:contents',
        MOBILE_SCROLL_STRIP,
        'max-sm:[&>*]:shrink-0 max-sm:[&>.contents>*]:shrink-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
