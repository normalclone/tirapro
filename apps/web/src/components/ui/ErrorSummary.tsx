import { useEffect, useState } from 'react';
import { errorCountLabel, focusField, type FieldError } from '@/lib/formErrors';

/**
 * Tóm tắt lỗi biểu mẫu: "3 trường cần sửa" + mỗi lỗi là một nút đưa focus tới đúng trường (không đổi hash URL).
 * Báo màn hình đọc: `role="alert"` (assertive) CHỈ lần đầu hiện; sau đó khung tĩnh, còn số lỗi nằm trong vùng
 * `aria-live="polite"` — sửa từng lỗi không bị đọc lại cả khối. Không có lỗi → không vẽ gì (lần sau hiện lại báo như lần đầu).
 * Màu từ token danger.
 */
export function ErrorSummary({
  errors,
  onNavigate = (id) => void focusField(id),
  className,
}: {
  errors: readonly FieldError[];
  /** Mặc định đưa focus tới ô có id đó; nơi có ô ngoài DOM thường (vd tab khác) có thể tự xử lý. */
  onNavigate?: (id: string) => void;
  className?: string;
}) {
  const has = errors.length > 0;
  const [announced, setAnnounced] = useState(false);
  useEffect(() => {
    setAnnounced(has);
  }, [has]);
  if (!has) return null;
  return (
    <div
      role={announced ? undefined : 'alert'}
      className={`rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 ${className ?? ''}`.trim()}
    >
      <p aria-live="polite" className="text-sm font-medium text-danger">
        {errorCountLabel(errors.length)}
      </p>
      <ul className="mt-1 space-y-0.5">
        {errors.map((e) => (
          <li key={e.id} className="text-sm text-ink">
            <button
              type="button"
              onClick={() => onNavigate(e.id)}
              className="rounded font-medium text-danger underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {e.label}
            </button>
            <span className="text-muted"> — {e.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
