import { useEffect, useReducer, useRef } from 'react';
import { focusFirstError, type FieldError } from '@/lib/formErrors';

export interface ErrorFlowState {
  /** Đã có lần gửi lỗi (từ đó lỗi hiện và tính lại theo form). */
  attempted: boolean;
  /** Số lần gửi lỗi — CHỈ `fail()` tăng; dùng làm `key`/dấu hiệu để báo màn hình mỗi lần gửi lỗi một thông báo. */
  attempts: number;
}

/** Reducer thuần (test được): `fail` bật hiển thị + tăng `attempts`; `reset` tắt hiển thị, không đụng `attempts`. */
export function errorFlowReducer(s: ErrorFlowState, action: 'fail' | 'reset'): ErrorFlowState {
  return action === 'fail'
    ? { attempted: true, attempts: s.attempts + 1 }
    : { attempted: false, attempts: s.attempts };
}

/**
 * Dòng báo lỗi của một biểu mẫu/hộp thoại: `all` = lỗi hiện có của form (tính lại mỗi lần render, thuần).
 * - Chưa thử gửi: không hiện gì (đừng báo lỗi khi người dùng chưa gõ xong).
 * - `fail()` khi gửi mà còn lỗi: bật hiển thị + tăng `attempts` + đưa focus tới lỗi đầu tiên THEO THỨ TỰ DOM, sau khi
 *   phần tóm tắt đã vẽ. Truyền `attempts` cho `ErrorSummary` để MỖI lần gửi lỗi được báo một lần (kể cả khi focus không
 *   đổi, vd ⌘/Ctrl+Enter đang đứng trong ô lỗi đầu).
 * - Sau đó `errors` luôn theo `all`: sửa tới đâu hết lỗi tới đó. `reset()` khi mở lại hộp.
 */
export function useErrorFlow(all: readonly FieldError[]) {
  const [state, dispatch] = useReducer(errorFlowReducer, { attempted: false, attempts: 0 });
  const errors = state.attempted ? all : [];
  const errorsRef = useRef(errors);
  errorsRef.current = errors;
  useEffect(() => {
    if (state.attempts > 0) focusFirstError(errorsRef.current);
  }, [state.attempts]);
  const fail = () => dispatch('fail');
  return {
    errors,
    attempts: state.attempts,
    errorOf: (id: string) => errors.find((e) => e.id === id)?.message,
    /** Gửi từ form/nút/phím: còn lỗi → `fail()`, hết lỗi → `onValid()`. Chặn gửi native của `<form>` khi có sự kiện. */
    attempt: (e: { preventDefault: () => void } | undefined, onValid: () => void) => {
      e?.preventDefault();
      if (all.length > 0) fail();
      else onValid();
    },
    fail,
    reset: () => dispatch('reset'),
  };
}
