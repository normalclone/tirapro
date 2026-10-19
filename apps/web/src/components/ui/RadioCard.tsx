import { useId, type ReactNode } from 'react';
import { FieldErrorText } from '@/components/ui/FieldError';
import { invalidAttrs } from '@/lib/formErrors';
import { radioGroupKeyDownSkipDisabled, shouldEmitChange } from '@/lib/radioNav';
import { cn } from '@/lib/utils';

export interface RadioCardOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Câu mô tả dưới nhãn; gắn vào thẻ qua `aria-describedby`. */
  description?: ReactNode;
  /** Thông tin phụ dưới mô tả (vd chuỗi bước của mẫu dự án). */
  meta?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Nội dung đi kèm lựa chọn (vd ô chọn sprint đích): CHỈ hiện khi thẻ đang được chọn. */
  children?: ReactNode;
}

/** Nhóm radio PHẢI có tên truy cập: nhãn chuỗi (`ariaLabel`) hoặc trỏ tới nhãn nhìn thấy (`ariaLabelledby`). */
export type RadioCardLabel =
  | { ariaLabel: string; ariaLabelledby?: undefined }
  | { ariaLabelledby: string; ariaLabel?: undefined };

/**
 * Nhóm thẻ chọn MỘT trong vài lựa chọn có mô tả (mẫu dự án, nơi chuyển việc, phạm vi chia sẻ…). Cùng quy ước với
 * `SegmentedControl`: radiogroup, roving tabindex (một điểm dừng Tab = mục đang chọn; `value=null` → mục bật đầu tiên),
 * mũi tên/Home/End chuyển chọn và bỏ qua mục tắt, chỉ phát `onChange` khi chọn mục KHÁC.
 * - Cả thẻ là nút bấm (`role="radio"`); mô tả nối qua `aria-describedby`; `children` hiện dưới thẻ khi được chọn.
 * - Chọn không chỉ bằng màu: chấm radio đặc + viền/nền token primary. Không side-stripe.
 * - `invalid` như `Input`: `true` → aria-invalid + viền danger; chuỗi → thêm lời lỗi dưới nhóm (id `<id>-error`).
 * - `size="sm"` cho danh sách dày (đệm nhỏ); dưới `sm`/cảm ứng mỗi thẻ cao ≥ 44px. Thẻ luôn xếp một cột.
 */
export function RadioCard<T extends string>({
  value,
  onChange,
  options,
  disabled = false,
  size = 'md',
  className,
  id,
  'aria-describedby': describedByProp,
  invalid,
  ...labelProps
}: RadioCardLabel & {
  /** `null` = chưa chọn mục nào. */
  value: T | null;
  onChange: (v: T) => void;
  options: readonly RadioCardOption<T>[];
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
  'aria-describedby'?: string;
  invalid?: boolean | string;
}) {
  const autoId = useId();
  const base = id ?? autoId;
  const attrs = invalidAttrs(invalid, base, describedByProp);
  const ariaLabel = 'ariaLabel' in labelProps ? labelProps.ariaLabel : undefined;
  const ariaLabelledby = 'ariaLabelledby' in labelProps ? labelProps.ariaLabelledby : undefined;
  const isOff = (o: RadioCardOption<T>) => disabled || !!o.disabled;
  const selected = options.findIndex((o) => o.value === value && !isOff(o));
  const entry = selected >= 0 ? selected : options.findIndex((o) => !isOff(o));
  const isInvalid = !!attrs.ariaInvalid;
  return (
    <>
      <div
        id={id}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={attrs.describedBy}
        aria-invalid={isInvalid ? true : undefined}
        aria-disabled={disabled ? 'true' : undefined}
        onKeyDown={disabled ? undefined : radioGroupKeyDownSkipDisabled}
        className={cn('flex flex-col', size === 'sm' ? 'gap-1.5' : 'gap-2', className)}
      >
        {options.map((o, i) => {
          const active = o.value === value;
          const off = isOff(o);
          const descId = o.description ? `${base}-${i}-desc` : undefined;
          return (
            <div
              key={o.value}
              data-selected={active ? 'true' : undefined}
              className={cn(
                'rounded-lg border transition-colors duration-150 motion-reduce:transition-none',
                'has-[button[role=radio]:focus-visible]:ring-2 has-[button[role=radio]:focus-visible]:ring-[var(--ring)]',
                active
                  ? 'border-primary bg-primary-subtle'
                  : cn(isInvalid ? 'border-danger' : 'border-border', !off && 'hover:bg-surface-2'),
                off && 'opacity-60',
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-describedby={descId}
                aria-disabled={off ? 'true' : undefined}
                disabled={off}
                tabIndex={i === entry ? 0 : -1}
                onClick={() => {
                  if (shouldEmitChange(value, o.value)) onChange(o.value);
                }}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg text-left focus-visible:outline-none',
                  'max-sm:min-h-11 [@media(pointer:coarse)]:min-h-11',
                  size === 'sm' ? 'px-2.5 py-1.5' : 'px-3 py-2.5',
                  off ? 'cursor-not-allowed' : 'cursor-pointer',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2',
                    active ? 'border-primary' : 'border-border-strong',
                  )}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                {o.icon && (
                  <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
                    {o.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  {o.description && (
                    <span id={descId} className="block text-xs text-muted">
                      {o.description}
                    </span>
                  )}
                  {o.meta}
                </span>
              </button>
              {active && o.children && <div className="px-3 pb-2.5 pl-10">{o.children}</div>}
            </div>
          );
        })}
      </div>
      {attrs.errorId && <FieldErrorText id={attrs.errorId}>{attrs.errorText}</FieldErrorText>}
    </>
  );
}
