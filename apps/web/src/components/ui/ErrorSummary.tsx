import { errorCountLabel, focusField, type FieldError } from '@/lib/formErrors';

/**
 * Tóm tắt lỗi biểu mẫu: "3 trường cần sửa" + mỗi lỗi là một nút đưa focus tới đúng trường (không đổi hash URL).
 * `role="alert"` nên trình đọc màn hình đọc ngay khi hiện. Không có lỗi → không vẽ gì. Màu từ token danger.
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
  if (errors.length === 0) return null;
  return (
    <div
      role="alert"
      className={`rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 ${className ?? ''}`.trim()}
    >
      <p className="text-sm font-medium text-danger">{errorCountLabel(errors.length)}</p>
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
