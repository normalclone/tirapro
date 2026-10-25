import { useEffect, useRef, useState } from 'react';

/** Trả giá trị khác-null gần nhất — để modal còn nội dung suốt hiệu ứng đóng khi đối tượng đích đã về `null`. */
export function useRetained<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(null);
  if (value != null) ref.current = value;
  return ref.current;
}

/**
 * Như `useRetained` nhưng chỉ giữ thêm `ms` mili-giây sau khi giá trị về `null` rồi trả `null` — đủ cho hiệu ứng đóng của modal,
 * sau đó gỡ hẳn (không để cây xem nhanh sống mãi với khoá cũ).
 */
export function useRetainedFor<T>(value: T | null | undefined, ms: number): T | null {
  const ref = useRef<T | null>(null);
  const [, bump] = useState(0);
  if (value != null) ref.current = value;
  useEffect(() => {
    if (value != null || ref.current == null) return;
    const id = window.setTimeout(() => {
      ref.current = null;
      bump((n) => n + 1);
    }, ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return ref.current;
}
