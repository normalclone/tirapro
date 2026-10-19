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

// Đang tải (`aria-busy`) không bị selector vô hiệu bắt nên `hover:` của biến thể vẫn chạy → nút đổi màu khi rê lúc đang tải.
// Mỗi biến thể thêm một class (0,3,0) trả về đúng màu gốc khi rê; KHÔNG gắn biến thể `enabled` vào hover (xem comment ở trên).
const BUSY_NO_HOVER_FLAT = 'aria-busy:hover:bg-transparent';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-150 ease-out-quart focus-visible:outline-none select-none',
  {
    variants: {
      variant: {
        primary: `bg-primary text-primary-fg hover:bg-primary-hover aria-busy:hover:bg-primary ${DISABLED_FILLED}`,
        secondary: `bg-surface-2 text-ink hover:bg-surface-3 aria-busy:hover:bg-surface-2 border border-border ${DISABLED_FILLED}`,
        ghost: `text-ink hover:bg-surface-2 ${BUSY_NO_HOVER_FLAT} ${DISABLED_FLAT}`,
        danger: `bg-danger text-white hover:opacity-90 aria-busy:hover:opacity-100 ${DISABLED_FILLED}`,
        // Giữ viền khi vô hiệu: bỏ viền thì nút outline trông như chữ trơn.
        outline: `border border-border text-ink hover:bg-surface-2 ${BUSY_NO_HOVER_FLAT} ${DISABLED_FLAT}`,
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-base',
        lg: 'h-10 px-5 text-base',
        // Cảm ứng: 44px (DESIGN.md "vùng chạm ≥ 44px"); chuột giữ 36px cho thanh công cụ gọn.
        icon: 'h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

/** Class của nút cho phần tử không phải <button> (vd `<Link>`): cùng biến thể/kích thước với `Button`. */
export const buttonVariants = button;

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
