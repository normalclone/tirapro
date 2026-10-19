import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { useId, useRef, type MouseEventHandler, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button, type ButtonProps } from './Button';

export interface SplitButtonItem {
  id: string;
  label: string;
  /** Mô tả ngắn dưới nhãn; đọc qua aria-describedby (tên truy cập của mục chỉ là nhãn). */
  hint?: string;
  onSelect: () => void;
}

const TOUCH_H = '[@media(pointer:coarse)]:h-11';

/**
 * Nút tách: nút CHÍNH (nút bình thường, mặc định `type="button"`; truyền `type="submit" form=…` để gửi form) + nút ▾ riêng
 * mở menu các hành động thay thế. Hai nửa chung `loading`/`disabled` (đang gửi thì không mở menu cũng không bấm thêm),
 * cao 44px trên con trỏ thô, nối thành một khối (bo góc ghép, khe 1px lộ nền).
 *
 * Chọn một mục: menu đóng TRƯỚC rồi mới chạy hành động, và KHÔNG trả focus về nút ▾ — hành động tự quyết định focus
 * (đóng hộp, focus ô nhập, hoặc tóm tắt lỗi); chạy trong lúc menu còn mở thì focus bị bẫy focus của menu kéo lại → rơi về body.
 * Thoát menu bằng Esc/bấm ra ngoài vẫn trả focus như thường.
 */
export function SplitButton({
  children,
  items,
  menuLabel = 'Tuỳ chọn khác',
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  type = 'button',
  form,
  title,
  onClick,
  className,
  align = 'end',
}: {
  children: ReactNode;
  items: SplitButtonItem[];
  /** Tên truy cập của nút ▾. */
  menuLabel?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  form?: string;
  title?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  align?: 'start' | 'end';
}) {
  const uid = useId();
  const pending = useRef<SplitButtonItem | null>(null);
  return (
    <DropdownMenu.Root>
      <div className={cn('inline-flex items-stretch gap-px', className)}>
        <Button
          type={type}
          form={form}
          title={title}
          variant={variant}
          size={size}
          loading={loading}
          disabled={disabled}
          onClick={onClick}
          className={cn('rounded-r-none', TOUCH_H)}
        >
          {children}
        </Button>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            loading={false}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            aria-label={menuLabel}
            className={cn('rounded-l-none !px-2', TOUCH_H, '[@media(pointer:coarse)]:min-w-11')}
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side="top"
          collisionPadding={12}
          sideOffset={6}
          onCloseAutoFocus={(e) => {
            const item = pending.current;
            if (!item) return; // Esc / bấm ra ngoài: trả focus về nút ▾ như thường
            pending.current = null;
            e.preventDefault();
            item.onSelect(); // menu đã đóng hẳn: focus hành động đặt không bị bẫy focus của menu kéo lại
          }}
          className="z-dropdown min-w-56 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none print:hidden"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              aria-describedby={item.hint ? `${uid}-${item.id}` : undefined}
              onSelect={() => {
                pending.current = item;
              }}
              className="flex cursor-pointer flex-col rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:justify-center"
            >
              {item.label}
              {item.hint && (
                <span id={`${uid}-${item.id}`} className="text-xs text-muted">
                  {item.hint}
                </span>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
