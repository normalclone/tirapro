import { Check, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

/**
 * "Sao chép liên kết" — liên kết TRONG ứng dụng (không có liên kết công khai): người nhận vẫn phải đăng nhập và có quyền
 * xem theo mức chia sẻ, liên kết không cấp thêm gì. `unsavedChange`: mức đang chọn khác mức đã lưu → nhắc có hiệu lực sau
 * khi lưu (liên kết hiện mở theo mức ĐÃ LƯU).
 */
export function CopyLinkRow({ url, unsavedChange }: { url: string; unsavedChange: boolean }) {
  const { copied, copy } = useCopyToClipboard('Đã sao chép liên kết');
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button variant="secondary" size="sm" onClick={() => void copy(url)}>
        {copied ? (
          <Check className="h-4 w-4 text-success" aria-hidden />
        ) : (
          <Link2 className="h-4 w-4" aria-hidden />
        )}
        Sao chép liên kết
      </Button>
      <p className="min-w-0 flex-1 text-xs text-muted">
        Liên kết chỉ mở được với người có quyền xem ở trên.
        {unsavedChange && <> Mức chia sẻ mới chỉ có hiệu lực sau khi bạn lưu.</>}
      </p>
    </div>
  );
}
