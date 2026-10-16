import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Gauge, Lock, RotateCcw } from 'lucide-react';
import { Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { WidgetState } from './widgetState';

export interface WidgetFrameProps {
  title: string;
  state: WidgetState;
  /** Lỗi của truy vấn (state `error`) — hiện câu tiếng Việt từ máy chủ. */
  error?: unknown;
  onRetry?: () => void;
  emptyText?: string;
  /** Câu cho state `forbidden`; mặc định nói về quyền xem dự án. */
  forbiddenText?: string;
  /** Liên kết "Xem tất cả" ở góc trên phải. */
  to?: { href: string; label: string };
  children?: ReactNode;
  className?: string;
}

/**
 * Khung một ô dashboard: tiêu đề + bốn trạng thái (đang tải / lỗi / trống / không có quyền). Mỗi ô tự dùng khung này
 * nên một ô lỗi hay thiếu quyền chỉ hỏng trong ô của nó, cả dashboard vẫn dùng được.
 */
export function WidgetFrame({
  title,
  state,
  error,
  onRetry,
  emptyText = 'Chưa có dữ liệu',
  forbiddenText = 'Bạn không có quyền xem dự án này',
  to,
  children,
  className,
}: WidgetFrameProps) {
  return (
    <section
      aria-label={title}
      aria-busy={state === 'loading' || undefined}
      className={cn(
        'print-avoid-break flex h-full min-w-0 flex-col rounded-lg border border-border bg-surface p-3',
        className,
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-medium text-ink-strong" title={title}>
          {title}
        </h3>
        {to && (
          <Link to={to.href} className="shrink-0 text-xs text-primary hover:underline print:hidden">
            {to.label}
          </Link>
        )}
      </div>
      <div className="min-h-[7rem] flex-1">
        {state === 'loading' && <WidgetSkeleton />}
        {state === 'error' && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span className="min-w-0 flex-1">
              {error ? apiErrorMessage(error) : 'Không tải được ô này'}
            </span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-3 print:hidden"
              >
                <RotateCcw className="h-3 w-3" aria-hidden /> Thử lại
              </button>
            )}
          </div>
        )}
        {state === 'forbidden' && (
          <p className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">
            <Lock className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            {forbiddenText}
          </p>
        )}
        {state === 'empty' && (
          <p className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">
            <Gauge className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            {emptyText}
          </p>
        )}
        {state === 'ready' && children}
      </div>
    </section>
  );
}

function WidgetSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

/**
 * Chốt chặn lỗi RENDER của một ô (vd dữ liệu bất ngờ làm biểu đồ ném lỗi): chỉ ô đó hiện khung lỗi, phần còn lại của
 * dashboard không sập. Lỗi tải dữ liệu đã được từng ô xử lý bằng `WidgetFrame`; đây là lớp lót cuối.
 */
export class WidgetBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[dashboard] widget render error', error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <WidgetFrame
        title={this.props.title}
        state="error"
        error={new Error('Ô này gặp lỗi khi hiển thị')}
        onRetry={() => this.setState({ failed: false })}
      />
    );
  }
}
