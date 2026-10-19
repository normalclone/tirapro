import { saveStatusText, type SaveStatusState } from '@/lib/saveStatus';
import { cn } from '@/lib/utils';

/**
 * Chỉ báo lưu tự động nhỏ ("Đang lưu…" / "Đã lưu lúc 14:02" / "Lỗi · Thử lại"). Vùng `aria-live="polite"` LUÔN có trong
 * trang (kể cả idle, rỗng) để trình đọc màn hình đã đăng ký trước khi chữ đổi. Lỗi có nút "Thử lại" thật khi truyền
 * `onRetry`. Fade ≤100ms, tắt khi reduced-motion; không icon nhún.
 */
export function SaveStatus({
  status,
  onRetry,
  className,
}: {
  status: SaveStatusState;
  onRetry?: () => void;
  className?: string;
}) {
  const isError = status.state === 'error';
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex min-h-5 items-center gap-1 text-xs transition-opacity duration-fast motion-reduce:transition-none',
        isError ? 'text-danger' : 'text-muted',
        status.state === 'idle' ? 'opacity-0' : 'opacity-100',
        className,
      )}
    >
      {isError ? (
        <>
          Lỗi ·{' '}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded font-medium underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Thử lại
            </button>
          ) : (
            'Thử lại'
          )}
        </>
      ) : (
        saveStatusText(status)
      )}
    </span>
  );
}
