import type { KeyboardEvent, ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZE: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tiêu đề hiển thị (cũng là tên truy cập của hộp thoại cho trình đọc màn hình). */
  title: string;
  description?: string;
  children?: ReactNode;
  /** Hàng nút cố định ở đáy (Huỷ / Lưu…). Với form tự có nút submit, bọc cả form quanh children và bỏ footer. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Cmd/Ctrl+Enter gọi onSubmit nếu có (kể cả khi đang gõ trong textarea). */
  onSubmit?: () => void;
  /** Class thêm cho vùng nội dung cuộn (vd bỏ padding khi nội dung tự quản lý bố cục). */
  bodyClassName?: string;
  /** Ẩn tiêu đề khỏi mắt nhìn nhưng vẫn giữ cho trình đọc màn hình (vd bảng lệnh có ô tìm riêng). */
  hideTitle?: boolean;
  /** Class thêm cho khung nội dung (vd đặt chiều cao cố định). */
  className?: string;
  /** Icon đứng trước tiêu đề (aria-hidden) — vd `<Sparkles className="h-4 w-4" />`, hoặc chấm màu. */
  icon?: ReactNode;
  /** Sắc của icon: `primary` (mặc định) hoặc `danger` cho xác nhận phá huỷ. */
  iconTone?: 'primary' | 'danger';
  /** Nội dung phụ cạnh tiêu đề (vd pill trạng thái hiện tại). */
  headerExtra?: ReactNode;
  /**
   * `right` = ngăn kéo cạnh phải, dùng cho panel phụ (PlanningPanel).
   * `bottom` = sheet neo đáy (menu Tạo/Tôi trên mobile): rộng hết màn, bo trên, trượt lên/xuống 240ms.
   */
  placement?: 'center' | 'right' | 'bottom';
  /** Tuỳ biến focus khi mở (gọi `e.preventDefault()` rồi tự focus phần tử mong muốn). */
  onOpenAutoFocus?: (e: Event) => void;
  /**
   * Tuỳ biến focus khi đóng (gọi `e.preventDefault()` rồi tự focus). Mặc định Radix trả focus về `Dialog.Trigger`,
   * mà hộp này mở bằng state nên không có trigger → focus rơi về `body`; nơi mở từ một nút nên tự trả focus về nút đó.
   */
  onCloseAutoFocus?: (e: Event) => void;
  /** Chặn Esc đóng hộp (gọi `e.preventDefault()`) — vd Esc đang dành để đóng một panel con. */
  onEscapeKeyDown?: (e: globalThis.KeyboardEvent) => void;
}

const CENTER_CLASS = [
  // `inset-0 m-auto h-fit` canh giữa mà không dùng transform → không xung đột với animation zoom.
  'fixed inset-0 z-modal m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg duration-base',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[.98]',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[.98]',
];

const RIGHT_CLASS = [
  'fixed inset-y-0 right-0 z-modal flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-surface shadow-lg duration-base',
  'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
  'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
];

// Sheet đáy: 240ms (token `slow`) ease-out-quart, không nảy. `animation-timing-function` đặt riêng vì `ease-*` của Tailwind
// chỉ áp cho transition. Nhánh `motion-reduce` bỏ trượt (chỉ còn hiện/ẩn tức thời).
const BOTTOM_CLASS = [
  'fixed inset-x-0 bottom-0 z-modal flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-lg duration-slow ease-out-quart [animation-timing-function:cubic-bezier(0.25,1,0.5,1)]',
  'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
  'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
  'motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none',
];

/**
 * Hộp thoại dùng chung, bọc @radix-ui/react-dialog: Radix lo focus-trap, Esc, trả focus về nút mở,
 * `role="dialog"` + `aria-modal`. Nút đóng (X) đặt CUỐI trong DOM để focus đầu tiên rơi vào ô nhập,
 * không rơi vào nút đóng. Nền tối nhạt (không blur/kính mờ), chuyển động 150ms — tắt hẳn khi người
 * dùng bật `prefers-reduced-motion` (quy tắc toàn cục ở globals.css).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  onSubmit,
  bodyClassName,
  hideTitle = false,
  className,
  icon,
  iconTone = 'primary',
  headerExtra,
  placement = 'center',
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
}: DialogProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onSubmit) return;
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.defaultPrevented) return;
    // Dialog lồng nhau: sự kiện React nổi lên qua portal — chỉ xử lý phím gõ bên trong chính hộp này.
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    onSubmit();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-modal bg-[oklch(0.2_0.014_256/0.45)] duration-base data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <RadixDialog.Content
          // Không có mô tả thì báo rõ cho Radix (tránh cảnh báo thiếu aria-describedby).
          {...(description ? {} : { 'aria-describedby': undefined })}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={onEscapeKeyDown}
          className={cn(
            placement === 'right'
              ? RIGHT_CLASS
              : placement === 'bottom'
                ? BOTTOM_CLASS
                : [CENTER_CLASS, SIZE[size]],
            className,
          )}
        >
          {placement === 'bottom' && (
            // Tay nắm trang trí (không kéo được) — gợi ý đây là sheet trượt từ đáy.
            <div
              aria-hidden
              className="mx-auto mt-2 h-1 w-8 shrink-0 rounded-full bg-border-strong"
            />
          )}
          <div
            className={cn(
              'shrink-0 px-5 pt-4 pr-14',
              children == null || children === false ? 'pb-3' : 'pb-1',
              hideTitle && 'sr-only',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              {icon && (
                <span
                  aria-hidden
                  className={cn(
                    'grid shrink-0 place-items-center',
                    // Xác nhận phá huỷ: huy hiệu tròn đỏ nhạt (như bản trước khi chuyển sang Dialog chung).
                    iconTone === 'danger'
                      ? 'h-7 w-7 rounded-full bg-danger/10 text-danger'
                      : 'text-primary',
                  )}
                >
                  {icon}
                </span>
              )}
              <RadixDialog.Title className="min-w-0 text-base font-semibold text-ink-strong">
                {title}
              </RadixDialog.Title>
              {headerExtra}
            </div>
            {description && (
              <RadixDialog.Description className="mt-1 text-sm text-muted">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          {children != null && children !== false && (
            <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-3', bodyClassName)}>
              {children}
            </div>
          )}
          {footer && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          )}
          <RadixDialog.Close
            aria-label="Đóng"
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
