import { useEffect, useRef, useState } from 'react';
import { focusFirstError, type FieldError } from '@/lib/formErrors';

/**
 * Dòng báo lỗi của một biểu mẫu/hộp thoại: `all` = lỗi hiện có của form (tính lại mỗi lần render, thuần).
 * - Chưa thử gửi: không hiện gì (đừng báo lỗi khi người dùng chưa gõ xong).
 * - `fail()` khi gửi mà còn lỗi: bật hiển thị + đưa focus tới lỗi đầu tiên THEO THỨ TỰ DOM, sau khi phần tóm tắt đã vẽ.
 * - Sau đó `errors` luôn theo `all`: sửa tới đâu hết lỗi tới đó. `reset()` khi mở lại hộp.
 */
export function useErrorFlow(all: readonly FieldError[]) {
  const [attempted, setAttempted] = useState(false);
  const [tick, setTick] = useState(0);
  const errors = attempted ? all : [];
  const errorsRef = useRef(errors);
  errorsRef.current = errors;
  useEffect(() => {
    if (tick > 0) focusFirstError(errorsRef.current);
  }, [tick]);
  const fail = () => {
    setAttempted(true);
    setTick((n) => n + 1);
  };
  return {
    errors,
    errorOf: (id: string) => errors.find((e) => e.id === id)?.message,
    /** Gửi từ form/nút/phím: còn lỗi → `fail()`, hết lỗi → `onValid()`. Chặn gửi native của `<form>` khi có sự kiện. */
    attempt: (e: { preventDefault: () => void } | undefined, onValid: () => void) => {
      e?.preventDefault();
      if (all.length > 0) fail();
      else onValid();
    },
    fail,
    reset: () => setAttempted(false),
  };
}
