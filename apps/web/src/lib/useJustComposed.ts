import { useCallback, useEffect, useRef } from 'react';

/** Safari phát Enter ngay sau `compositionend`; cửa sổ này đủ rộng cho hai sự kiện liền nhau, vẫn hẹp hơn nhịp gõ người. */
const JUST_COMPOSED_MS = 100;

/**
 * Cờ "bộ gõ vừa chốt chữ" cho ô nhập: gắn `onCompositionEnd` vào ô, đọc `take()` ở keydown (đọc xong là xoá — chỉ chặn đúng
 * phím kế tiếp). Cùng ngưỡng với `useRequireText`.
 */
export function useJustComposed() {
  const flag = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onCompositionEnd = useCallback(() => {
    flag.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      flag.current = false;
    }, JUST_COMPOSED_MS);
  }, []);
  const take = useCallback(() => {
    const v = flag.current;
    flag.current = false;
    return v;
  }, []);
  return { onCompositionEnd, take };
}
