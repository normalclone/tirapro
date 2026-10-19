import { errorCountLabel, focusField, type FieldError } from '@/lib/formErrors';

/**
 * Tóm tắt lỗi biểu mẫu: "3 trường cần sửa" + mỗi lỗi là một nút đưa focus tới đúng trường (không đổi hash URL).
 * Báo màn hình đọc: MỖI lần gửi lỗi một thông báo — khối ẩn `role="alert"` gắn `key={attempt}` (truyền `flow.attempts` của
 * `useErrorFlow`) nên được dựng lại và đọc lại cả khi focus không đổi. Số lỗi hiển thị nằm trong `aria-live="polite"`:
 * sửa dần từng lỗi chỉ báo nhẹ khi số đổi, KHÔNG báo mỗi lần gõ. Không có lỗi → không vẽ gì. Màu từ token danger.
 */
export function ErrorSummary({
  errors,
  attempt,
  onNavigate = (id) => void focusField(id),
  className,
}: {
  errors: readonly FieldError[];
  /** Số lần gửi lỗi (`useErrorFlow().attempts`): đổi → báo lại một lần. */
  attempt: number;
  /** Mặc định đưa focus tới ô có id đó; nơi có ô ngoài DOM thường (vd tab khác) có thể tự xử lý. */
  onNavigate?: (id: string) => void;
  className?: string;
}) {
  if (errors.length === 0) return null;
  const count = errorCountLabel(errors.length);
  return (
    <div
      className={`rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 ${className ?? ''}`.trim()}
    >
      <p key={attempt} role="alert" className="sr-only">
        {count}
      </p>
      <p aria-live="polite" className="text-sm font-medium text-danger">
        {count}
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
