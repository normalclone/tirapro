import { EMPTY_SELECTION, type Selection } from './selection';

/**
 * Kho nhỏ giữ `Selection` ngoài React: mỗi thẻ đăng ký riêng qua `useSyncExternalStore` với bộ chọn (đã chọn chưa?) nên
 * đổi lựa chọn chỉ vẽ lại đúng thẻ đổi, không vẽ lại cả bảng (thẻ `memo` giữ nguyên).
 */
export interface SelectionStore {
  getState: () => Selection;
  subscribe: (listener: () => void) => () => void;
  /** Áp hàm thuần lên trạng thái; chỉ báo người nghe khi kết quả KHÁC tham chiếu cũ. */
  update: (fn: (s: Selection) => Selection) => void;
}

export function createSelectionStore(): SelectionStore {
  let state: Selection = EMPTY_SELECTION;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    update(fn) {
      const next = fn(state);
      if (next === state) return;
      state = next;
      for (const l of [...listeners]) l();
    },
  };
}
