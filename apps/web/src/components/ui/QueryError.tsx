import { AlertTriangle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/api';

/** Trạng thái LỖI dùng chung cho mọi màn dùng useQuery: thông báo + nút Thử lại. */
export function QueryError({
  error,
  onRetry,
  message,
  className,
}: {
  error?: unknown;
  onRetry?: () => void;
  message?: string;
  className?: string;
}) {
  const text = message ?? (error ? apiErrorMessage(error) : 'Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại.');
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center', className)}>
      <span className="grid h-10 w-10 place-items-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <p className="max-w-sm text-sm text-muted">{text}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Thử lại
        </button>
      )}
    </div>
  );
}
