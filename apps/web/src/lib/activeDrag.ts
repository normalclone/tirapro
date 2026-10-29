import { useSyncExternalStore } from 'react';

let current: string | null = null;
const subs = new Set<() => void>();

/**
 * Id việc đang được kéo (null = không kéo). Chỉ đổi lúc BẮT ĐẦU/KẾT THÚC kéo, nên component dùng `useActiveDragId` không vẽ lại
 * theo từng nhịp con trỏ như `useDndContext` (giá trị context đổi mỗi lần di chuyển vì `collisions` được tính lại).
 */
export const activeDrag = {
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

export function useActiveDragId(): string | null {
  return useSyncExternalStore(activeDrag.subscribe, activeDrag.get);
}
