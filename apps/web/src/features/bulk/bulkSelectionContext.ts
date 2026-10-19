import { createContext, useSyncExternalStore } from 'react';
import type { SelectionStore } from './selectionStore';

/**
 * Ngữ cảnh chọn nhiều cho các thẻ (Bảng việc). Giá trị ỔN ĐỊNH (kho + hành động đều có tham chiếu cố định) nên đổi lựa chọn
 * không làm cả cây vẽ lại; từng thẻ đăng ký riêng qua `useIsSelected`. `null` = không chọn nhiều ở đây (không quyền / bản xem trước).
 */
export interface BulkSelectionApi {
  store: SelectionStore;
  toggle: (id: string) => void;
  /** Shift+click: chọn dải từ mốc tới `id` theo thứ tự hiển thị. */
  range: (id: string) => void;
}

export const BulkSelectionContext = createContext<BulkSelectionApi | null>(null);

const noopSubscribe = () => () => undefined;

/** Thẻ này có đang được chọn không — chỉ vẽ lại khi CHÍNH nó đổi. */
export function useIsSelected(store: SelectionStore | undefined, id: string): boolean {
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => store?.getState().ids.has(id) ?? false,
  );
}

/** Đang có ít nhất một việc được chọn không — đổi đúng hai lần (có/không) nên rẻ cho mọi thẻ. */
export function useHasSelection(store: SelectionStore | undefined): boolean {
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => (store?.getState().ids.size ?? 0) > 0,
  );
}
