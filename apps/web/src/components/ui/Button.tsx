import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Vô hiệu = token `disabled-*`, không dùng độ mờ (opacity làm nút chính ở theme tối trông như đang bật).
// Đang tải (`aria-busy`) cũng có `disabled` nhưng giữ màu biến thể + spinner nên bị loại khỏi selector.
// Selector này (0,3,0) thắng mọi `hover:` (0,2,0) của biến thể lẫn của nơi dùng, nên nút vô hiệu không đổi nền/chữ/độ mờ khi rê chuột;
// KHÔNG gắn biến thể `enabled` vào hover vì (0,3,0) làm `hover:` ghi đè từ className bị mất (twMerge không gộp hai nhóm biến thể khác nhau).
// Chuỗi class viết đủ (không nối) để Tailwind quét được.
const DISABLED_FILLED =
  '[&:disabled:not([aria-busy=true])]:bg-disabled-bg [&:disabled:not([aria-busy=true])]:text-disabled-fg [&:disabled:not([aria-busy=true])]:border-transparent [&:disabled:not([aria-busy=true])]:shadow-none [&:disabled:not([aria-busy=true])]:opacity-100 [&:disabled:not([aria-busy=true])]:cursor-not-allowed aria-busy:cursor-progress';
// Ghost/outline vô hiệu: nền trong suốt, chỉ đổi màu chữ (không nền xám).
const DISABLED_FLAT =
  '[&:disabled:not([aria-busy=true])]:bg-transparent [&:disabled:not([aria-busy=true])]:text-disabled-fg [&:disabled:not([aria-busy=true])]:shadow-none [&:disabled:not([aria-busy=true])]:cursor-not-allowed aria-busy:cursor-progress';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-150 ease-out-quart focus-visible:outline-none select-none',
  {
    variants: {
      variant: {
        primary: `bg-primary text-primary-fg hover:bg-primary-hover ${DISABLED_FILLED}`,
        secondary: `bg-surface-2 text-ink hover:bg-surface-3 border border-border ${DISABLED_FILLED}`,
        ghost: `text-ink hover:bg-surface-2 ${DISABLED_FLAT}`,
        danger: `bg-danger text-white hover:opacity-90 ${DISABLED_FILLED}`,
        // Giữ viền khi vô hiệu: bỏ viền thì nút outline trông như chữ trơn.
        outline: `border border-border text-ink hover:bg-surface-2 ${DISABLED_FLAT}`,
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-base',
        lg: 'h-10 px-5 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
