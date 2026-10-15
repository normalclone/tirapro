import { useRef } from 'react';

/** Trả giá trị khác-null gần nhất — để modal còn nội dung suốt hiệu ứng đóng khi đối tượng đích đã về `null`. */
export function useRetained<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(null);
  if (value != null) ref.current = value;
  return ref.current;
}
