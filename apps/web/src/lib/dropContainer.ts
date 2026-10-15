import { useSyncExternalStore } from 'react';

let current: string | null = null;
const subs = new Set<() => void>();

/**
 * Container (cột/ô) mà thẻ đang kéo SẼ được đặt vào khi thả — chỉ khi nó khác container nguồn và kết quả thả thật sự
 * đổi gì đó. Tính một lần ở `onDragMove`; mỗi cột chỉ vẽ lại khi trạng thái "là đích" của CHÍNH nó đổi (selector boolean),
 * thay cho `useDndContext` làm mọi cột vẽ lại theo từng nhịp con trỏ.
 */
export const dropContainer = {
  get: () => current,
  set: (next: string | null) => {
    if (current === next) return;
    current = next;
    subs.forEach((f) => f());
  },
  subscribe: (f: () => void) => {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

export function useIsDropContainer(id: string): boolean {
  return useSyncExternalStore(dropContainer.subscribe, () => current === id);
}
