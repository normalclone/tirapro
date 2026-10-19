import { createElement, type ReactNode } from 'react';
import { AlertTriangle, Lock, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';

const VARIANTS = {
  'not-found': { Icon: SearchX, tone: 'bg-surface-2 text-muted' },
  forbidden: { Icon: Lock, tone: 'bg-surface-2 text-muted' },
  error: { Icon: AlertTriangle, tone: 'bg-danger/10 text-danger' },
} as const;

/** Thẻ tiêu đề theo cấp (mặc định h1; panel nằm cạnh trang đã có h1 dùng 2). */
export function headingTag(level: 1 | 2 | 3 = 1): 'h1' | 'h2' | 'h3' {
  return `h${level}`;
}

/**
 * Trạng thái "trang/đối tượng không dùng được": không tìm thấy, không có quyền, lỗi hiển thị.
 * Khác `EmptyState` (danh sách trống, viền đứt): đây là cả nội dung chính của màn.
 * `headingLevel`: cấp thẻ tiêu đề (1|2|3, mặc định 1 — màn nội dung chính; panel phụ cạnh trang đã có h1 dùng 2).
 * `error` dùng role="alert" (đọc ngay); hai loại còn lại role="status".
 */
export function StatusPanel({
  variant,
  title,
  description,
  children,
  actions,
  className,
  headingLevel = 1,
}: {
  variant: keyof typeof VARIANTS;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2 | 3;
}) {
  const { Icon, tone } = VARIANTS[variant];
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('mx-auto w-full max-w-md px-4 py-16 text-center', className)}
    >
      <span
        className={cn('mx-auto grid h-10 w-10 place-items-center rounded-full', tone)}
        aria-hidden
      >
        <Icon className="h-5 w-5" />
      </span>
      {createElement(
        headingTag(headingLevel),
        { className: 'mt-3 text-lg font-semibold text-ink-strong' },
        title,
      )}
      {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      {children}
      {actions && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}
