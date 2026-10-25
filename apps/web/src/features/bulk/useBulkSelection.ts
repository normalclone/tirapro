import { useMemo, useRef, useSyncExternalStore } from 'react';
import { clearSelection, pruneSelection, selectRange, setMany, toggleId } from './selection';
import { createSelectionStore, type SelectionStore } from './selectionStore';

/**
 * Chọn nhiều cho một danh sách/bảng. `orderedIds` = thứ tự HIỂN THỊ hiện tại (cho Shift+click chọn dải); không truyền thì
 * không có chọn dải. Mọi hành động có tham chiếu ổn định. Trang đọc `selected` (vẽ lại khi đổi); `store` để từng thẻ đăng ký riêng (xem `selectionStore`).
 */
export function useBulkSelection(orderedIds?: readonly string[]) {
  const storeRef = useRef<SelectionStore | null>(null);
  storeRef.current ??= createSelectionStore();
  const store = storeRef.current;
  const orderRef = useRef(orderedIds);
  orderRef.current = orderedIds;

  const state = useSyncExternalStore(store.subscribe, store.getState);
  const actions = useMemo(
    () => ({
      toggle: (id: string) => store.update((s) => toggleId(s, id)),
      /** Shift+click: chọn dải từ mốc tới `id` theo thứ tự hiển thị. */
      range: (id: string) => store.update((s) => selectRange(s, orderRef.current ?? [], id)),
      setMany: (ids: readonly string[], on: boolean) => store.update((s) => setMany(s, ids, on)),
      clear: () => store.update(clearSelection),
      /** Bỏ id không còn trong `valid` (dữ liệu làm mới/realtime). */
      prune: (valid: ReadonlySet<string>) => store.update((s) => pruneSelection(s, valid)),
    }),
    [store],
  );
  return { selected: state.ids, store, ...actions };
}
