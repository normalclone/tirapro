import { Printer } from 'lucide-react';
import { printTitle } from '@/lib/printTitle';
import { cn } from '@/lib/utils';
import { Button } from './Button';

/**
 * Nút "In / Lưu PDF": dùng hộp thoại in của trình duyệt (CSS `@media print`) — không thêm thư viện, chữ chọn được và
 * tiếng Việt đúng; người dùng chọn "Lưu thành PDF" ở hộp thoại. Đặt `document.title` tạm thời để tên file PDF gợi ý có
 * ngày, khôi phục ở `afterprint`.
 */
export function PrintButton({ title, className }: { title: string; className?: string }) {
  function print() {
    const prev = document.title;
    document.title = printTitle(title, new Date());
    const restore = () => {
      document.title = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={print}
      title="Mở hộp thoại in — chọn “Lưu thành PDF” để tải file"
      className={cn('print:hidden', className)}
    >
      <Printer className="h-4 w-4" aria-hidden /> In / Lưu PDF
    </Button>
  );
}
