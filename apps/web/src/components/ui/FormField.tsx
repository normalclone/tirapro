import type { ReactNode } from 'react';
import { FieldErrorText } from '@/components/ui/FieldError';
import { describedBy, fieldErrorId } from '@/lib/formErrors';

/** Thuộc tính FormField truyền cho ô con để nối nhãn, gợi ý và lỗi. */
export interface FormFieldA11y {
  id: string;
  invalid: boolean;
  'aria-describedby': string | undefined;
}

/**
 * Trường biểu mẫu dùng chung: nhãn (htmlFor) + ô + gợi ý + lời lỗi. Truyền hàm làm `children` để nhận
 * `{id, invalid, aria-describedby}` rải thẳng vào ô (`<Input {...p} />`, `<SearchSelect id={p.id} invalid={p.invalid} />`).
 * Lời lỗi do FormField vẽ (ô nhận `invalid` boolean, không vẽ lần hai).
 */
export function FormField({
  id,
  label,
  hint,
  error,
  className,
  labelClassName,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  /** Lời lỗi (chuỗi không rỗng = trường đang sai). */
  error?: string;
  className?: string;
  /** Thay kiểu nhãn mặc định (`mb-1 block text-xs font-medium text-muted`) cho khớp hộp thoại dùng nhãn `text-sm`. */
  labelClassName?: string;
  children: ReactNode | ((a11y: FormFieldA11y) => ReactNode);
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const hasError = !!error && error.trim() !== '';
  const a11y: FormFieldA11y = {
    id,
    invalid: hasError,
    'aria-describedby': describedBy(hintId, hasError && fieldErrorId(id)),
  };
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClassName ?? 'mb-1 block text-xs font-medium text-muted'}>
        {label}
      </label>
      {typeof children === 'function' ? children(a11y) : children}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-faint">
          {hint}
        </p>
      )}
      {hasError && <FieldErrorText id={fieldErrorId(id)}>{error}</FieldErrorText>}
    </div>
  );
}
