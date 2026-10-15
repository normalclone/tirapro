import { useSyncExternalStore } from 'react';

export interface DropHint {
  id: string;
  edge: 'before' | 'after';
}
let current: DropHint | null = null;
const subs = new Set<() => void>();
const same = (a: DropHint | null, b: DropHint | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.edge === b.edge);

/** Một lần kéo tại một thời điểm → store toàn cục nhỏ; mỗi thẻ chỉ vẽ lại khi hint CỦA NÓ đổi (selector trả string|null). */
export const dropHint = {
  get: () => current,
  set(next: DropHint | null) {
    if (same(current, next)) return;
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

export function useDropEdge(id: string): 'before' | 'after' | null {
  return useSyncExternalStore(dropHint.subscribe, () => (current?.id === id ? current.edge : null));
}
