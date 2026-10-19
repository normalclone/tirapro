import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { FieldErrorText } from '@/components/ui/FieldError';
import { INVALID_FIELD_CLS, invalidAttrs } from '@/lib/formErrors';
import { cn } from '@/lib/utils';

/** Cỡ chữ lớn hơn 16px (text-lg = 17px trở lên) thì ô giữ cỡ đó trên mobile — luật 16px là TỐI THIỂU. */
const LARGE_TEXT = /(^|\s)text-(lg|xl|2xl|3xl)(\s|$)/;

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /**
   * Ô đang sai. `true` → viền danger + `aria-invalid` (lời lỗi do nơi khác vẽ, vd `FormField`). Chuỗi → thêm lời lỗi
   * ngay dưới ô với id ổn định `<id>-error`, và `aria-describedby` trỏ tới đó (nối sau gợi ý có sẵn).
   */
  invalid?: boolean | string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, id, 'aria-describedby': describedByProp, ...props }, ref) => {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const a = invalidAttrs(invalid, fieldId, describedByProp);
    const input = (
      <input
        ref={ref}
        id={id}
        className={cn(
          // 16px dưới sm: iOS Safari tự phóng to trang khi focus ô < 16px (`text-base` của dự án = 14px).
          'h-9 w-full rounded-md border border-border bg-bg px-3 text-base text-ink',
          !LARGE_TEXT.test(className ?? '') && 'max-sm:text-[16px]',
          'placeholder:text-faint transition-colors duration-150',
          'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          'disabled:bg-disabled-bg disabled:text-disabled-fg disabled:cursor-not-allowed',
          a.ariaInvalid && INVALID_FIELD_CLS,
          className,
        )}
        aria-invalid={a.ariaInvalid}
        aria-describedby={a.describedBy}
        {...props}
      />
    );
    if (!a.errorId) return input;
    return (
      <>
        {input}
        <FieldErrorText id={a.errorId}>{a.errorText}</FieldErrorText>
      </>
    );
  },
);
Input.displayName = 'Input';
