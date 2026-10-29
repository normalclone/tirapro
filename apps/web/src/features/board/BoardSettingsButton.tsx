import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { CHIP_TOUCH_HIT } from '@/lib/touchHit';

/**
 * Nút "Cài đặt bảng". Hai dạng, mỗi dạng chỉ hiện ở một cỡ màn hình (cái kia `display: none` nên không nhận Tab):
 *  - `compact` (dưới `sm`): nút icon dạng chip 44px, đặt ĐẦU dải điều khiển trong DOM để thứ tự Tab = thứ tự hiển thị
 *    (cao 28px + vùng bấm dọc mở rộng → 44×44);
 *  - mặc định (từ `sm`): nút có nhãn ở cuối thanh, như trước.
 */
export function BoardSettingsButton({
  compact,
  onClick,
}: {
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      aria-label="Cài đặt bảng"
      title="Cài đặt bảng: cột, giới hạn WIP, bộ lọc và cách chia hàng"
      className={
        compact ? cn('h-7 w-11 rounded-full px-0 sm:hidden', CHIP_TOUCH_HIT) : 'max-sm:hidden'
      }
    >
      <Settings className="h-4 w-4" />
      {!compact && 'Cài đặt bảng'}
    </Button>
  );
}
