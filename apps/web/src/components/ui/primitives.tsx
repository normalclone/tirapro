import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn, initials } from '@/lib/utils';

/** Avatar tròn với initials fallback. */
export function Avatar({
  name,
  src,
  size = 24,
  decorative = false,
}: {
  name: string;
  src?: string | null;
  size?: number;
  /** Tên đã nằm trong chữ kế bên (vd tiêu đề thông báo): ẩn khỏi trình đọc màn hình, không tooltip, `alt=""`. */
  decorative?: boolean;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary-subtle text-[10px] font-semibold text-primary overflow-hidden"
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
      title={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
    >
      {src ? (
        <img src={src} alt={decorative ? '' : name} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** `title` = câu giải nghĩa hiện tức thì khi rê chuột (xem InstantTooltip). */
export function Badge({
  children,
  className,
  dotColor,
  title,
}: {
  children: ReactNode;
  className?: string;
  dotColor?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
    >
      {dotColor && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor }} />}
      {children}
    </span>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} {...props} />;
}

/**
 * DelayedSpinner — chỉ hiện sau `delay`ms (mặc định 350ms). Nếu nội dung tải xong
 * trước đó thì spinner KHÔNG bao giờ xuất hiện (theo nguyên tắc: nhanh đến mức không
 * kịp hiện loader). Tránh "spinner flash".
 */
export function DelayedSpinner({ delay = 350, label }: { delay?: number; label?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  if (!show) return null;
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted animate-in fade-in duration-200">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? 'Đang tải…'}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'default',
}: {
  /** Bắt buộc: khối trống luôn có hình để người dùng nhận ra đây là trạng thái, không phải lỗi tải. */
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** `compact` cho khối nằm trong thẻ/panel; `default` cho cả vùng nội dung của trang. */
  size?: 'default' | 'compact';
}) {
  const compact = size === 'compact';
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border text-center',
        compact ? 'gap-2 px-4 py-6 text-sm' : 'gap-3 px-6 py-12',
      )}
    >
      <div aria-hidden="true" className={cn('text-faint', compact && '[&_svg]:h-5 [&_svg]:w-5')}>
        {icon}
      </div>
      <div>
        <p className="break-words font-medium text-ink-strong">{title}</p>
        {description && (
          <p className={cn('mt-1 max-w-sm text-muted', compact ? 'text-xs' : 'text-sm')}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
