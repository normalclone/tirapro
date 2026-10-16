import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        // 16px dưới sm: iOS Safari tự phóng to trang khi focus ô < 16px (`text-base` của dự án = 14px).
        'h-9 w-full rounded-md border border-border bg-bg px-3 text-base text-ink max-sm:text-[16px]',
        'placeholder:text-faint transition-colors duration-150',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
