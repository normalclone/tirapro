import { useSyncExternalStore } from 'react';

/** Theo dõi một media query (vd `(min-width: 640px)`); SSR/khung hình đầu dùng `fallback`. */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener('change', notify);
      return () => mq?.removeEventListener('change', notify);
    },
    () => window.matchMedia?.(query).matches ?? fallback,
    () => fallback,
  );
}
