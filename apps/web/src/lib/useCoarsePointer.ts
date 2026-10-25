import { useSyncExternalStore } from 'react';

const QUERY = '(pointer: coarse)';
const listeners = new Set<() => void>();
let mq: MediaQueryList | null = null;

function notify() {
  listeners.forEach((l) => l());
}

/** MỘT bộ nghe media query chung cho mọi dòng/thẻ (hàng trăm dòng không đăng ký hàng trăm bộ nghe). */
function subscribe(cb: () => void) {
  if (listeners.size === 0) {
    mq = window.matchMedia?.(QUERY) ?? null;
    mq?.addEventListener('change', notify);
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      mq?.removeEventListener('change', notify);
      mq = null;
    }
  };
}

/** Thiết bị chính là cảm ứng (`pointer: coarse`)? Ngoài trình duyệt (SSR/test) → false. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(QUERY).matches ?? false,
    () => false,
  );
}
