import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { backLabel } from './subNavModel';

/** Link "‹ Cài đặt" của mobile "bước vào": chỉ hiện dưới `lg` (từ lg đã có rail/breadcrumb). */
export function BackLink({
  label,
  to,
  className,
}: {
  label: string;
  to: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      aria-label={backLabel(label)}
      className={cn(
        'inline-flex min-h-9 items-center gap-0.5 rounded-md pr-2 text-sm font-medium text-muted transition-colors hover:text-ink-strong lg:hidden',
        className,
      )}
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
