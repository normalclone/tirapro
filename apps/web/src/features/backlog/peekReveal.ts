import { createContext } from 'react';

/**
 * Các danh sách ảo hoá của Việc chờ đăng ký "đưa dòng này vào tầm nhìn" (cuộn ảo hoá tới chỉ số). Panel xem nhanh bước tới một
 * dòng CHƯA vẽ → `reveal(key)` hỏi lần lượt từng khu cho tới khi một khu nhận (trả true).
 */
type RevealFn = (key: string) => boolean;

export interface RevealRegistry {
  add: (fn: RevealFn) => () => void;
  /** true nếu có khu nhận dòng này. */
  reveal: (key: string) => boolean;
}

export function createRevealRegistry(): RevealRegistry {
  const fns = new Set<RevealFn>();
  return {
    add(fn) {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    reveal(key) {
      for (const fn of fns) if (fn(key)) return true;
      return false;
    },
  };
}

export const PeekRevealContext = createContext<RevealRegistry | null>(null);
