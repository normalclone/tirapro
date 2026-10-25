import { useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { SWITCH_TOUCH_HIT } from '@/lib/touchHit';
import { cn } from '@/lib/utils';

/**
 * Công tắc bật/tắt tức thì (`button role="switch"`): nhãn + mô tả bên trái, công tắc bên phải.
 * - Tên truy cập CHỈ là nhãn (`aria-labelledby` → span nhãn); mô tả nối riêng qua `aria-describedby` (không đọc hai lần).
 * - Bấm nhãn cũng bật/tắt (`label htmlFor`). Space/Enter nhờ `<button>` native.
 * - Bật/tắt khác nhau hơn màu: núm trượt sang phải + dấu tích trong núm. `motion-reduce` tắt chuyển động.
 * - Cảm ứng: hàng cao ≥ 44px, vùng bấm công tắc mở rộng (`SWITCH_TOUCH_HIT`).
 * - `disabled`: giữ `opacity` (công tắc vô hiệu vẫn phải đọc được trạng thái bật/tắt), `aria-disabled`.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const auto = useId();
  const base = id ?? auto;
  const labelId = `${base}-label`;
  const descId = description ? `${base}-desc` : undefined;
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 [@media(pointer:coarse)]:min-h-11',
        className,
      )}
    >
      <div className="min-w-0">
        <label
          id={labelId}
          htmlFor={base}
          className={cn(
            'block text-sm font-medium text-ink',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-xs text-faint">
            {description}
          </p>
        )}
      </div>
      <button
        id={base}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        aria-disabled={disabled ? 'true' : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          SWITCH_TOUCH_HIT,
          // Giữ disabled:opacity (không dùng token vô hiệu) — trạng thái bật/tắt phải còn đọc được khi vô hiệu.
          'inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-fast motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-surface-3',
        )}
      >
        <span
          className={cn(
            'inline-flex h-4 w-4 transform items-center justify-center rounded-full bg-white shadow transition-transform duration-fast motion-reduce:transition-none',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        >
          {checked && <Check aria-hidden="true" className="h-3 w-3 text-primary" strokeWidth={3} />}
        </span>
      </button>
    </div>
  );
}
