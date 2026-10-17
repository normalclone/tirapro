import type { ReactNode } from 'react';
import { radioGroupKeyDownSkipDisabled, shouldEmitChange } from '@/lib/radioNav';
import { SEGMENT_TOUCH_HIT } from '@/lib/touchHit';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * Nhóm lựa chọn 2–4 mục loại trừ nhau (radiogroup): combinator, hướng sắp xếp, chế độ, phạm vi. Mũi tên/Home/End chuyển
 * chọn và focus (roving tabindex, bỏ qua mục tắt). Thay `<select>` khi ít lựa chọn và nhãn ngắn.
 * - `disabled`: tắt cả nhóm (token disabled). `size="sm"` (h-8) cho hàng gọn/trong bảng; mặc định `md` (h-9).
 * - `fullWidth`: `true` luôn chia đều chiều ngang, `false` không bao giờ, bỏ trống = chỉ dưới breakpoint `sm`.
 * - Cần `ariaLabel` hoặc `ariaLabelledby` (nhãn nhìn thấy của nhóm).
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  ariaLabelledby,
  disabled = false,
  size = 'md',
  fullWidth,
  className,
  id,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly SegmentedOption<T>[];
  ariaLabel?: string;
  ariaLabelledby?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
  id?: string;
}) {
  const isOff = (o: SegmentedOption<T>) => disabled || !!o.disabled;
  // Roving tabindex: mục đang chọn (nếu bật) là điểm vào; không khớp thì mục bật đầu tiên.
  const selected = options.findIndex((o) => o.value === value && !isOff(o));
  const entry = selected >= 0 ? selected : options.findIndex((o) => !isOff(o));

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-disabled={disabled ? 'true' : undefined}
      onKeyDown={disabled ? undefined : radioGroupKeyDownSkipDisabled}
      className={cn(
        'items-stretch rounded-md border border-border p-0.5',
        disabled ? 'bg-disabled-bg' : 'bg-surface-2',
        size === 'sm' ? 'h-8' : 'h-9',
        fullWidth === true
          ? 'flex w-full'
          : fullWidth === false
            ? 'inline-flex'
            : 'inline-flex max-sm:flex max-sm:w-full',
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        const off = isOff(o);
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={off ? 'true' : undefined}
            disabled={off}
            tabIndex={i === entry ? 0 : -1}
            title={o.label}
            onClick={() => {
              if (shouldEmitChange(value, o.value)) onChange(o.value);
            }}
            className={cn(
              SEGMENT_TOUCH_HIT,
              'inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-sm font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              fullWidth === true ? 'grow' : fullWidth === undefined ? 'max-sm:grow' : '',
              off
                ? cn('cursor-not-allowed text-disabled-fg', active && 'bg-surface/60')
                : active
                  ? 'bg-surface text-ink-strong shadow-sm'
                  : 'text-muted hover:text-ink',
            )}
          >
            {o.icon && (
              <span aria-hidden="true" className="inline-flex shrink-0">
                {o.icon}
              </span>
            )}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
