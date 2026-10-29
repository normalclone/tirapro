import { useEffect, useState } from 'react';

/** Giá trị `value` sau khi đứng yên `ms` mili giây (mặc định 300) — để không gọi API mỗi phím gõ. */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
