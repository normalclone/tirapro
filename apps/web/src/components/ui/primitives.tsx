import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn, initials } from '@/lib/utils';

/** Avatar tròn với initials fallback. */
export function Avatar({ name, src, size = 24 }: { name: string; src?: string | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary-subtle text-[10px] font-semibold text-primary overflow-hidden"
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
      title={name}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

export function Badge({ children, className, dotColor }: { children: ReactNode; className?: string; dotColor?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', className)}>
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

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <div>
        <p className="font-medium text-ink-strong">{title}</p>
        {description && <p className="mt-1 text-sm text-muted max-w-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
