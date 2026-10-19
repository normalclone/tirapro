import { useEffect, useId, useRef } from 'react';
import { shouldBlockNavigation } from '@/lib/unsavedChanges';
import { useLeaveGuard } from '@/lib/useLeaveGuard';
import { useUnsavedStore } from '@/stores/unsaved';

const DEFAULT_DESCRIPTION = 'Rời đi bây giờ thì những chỗ bạn vừa sửa sẽ mất.';

/**
 * Đăng ký form vào thanh "thay đổi chưa lưu" (AppShell) + chặn rời trang (bọc `useLeaveGuard`).
 * `bar: false` = chỉ chặn rời trang, form tự giữ nút Lưu của nó. `onSave`/`onReset` luôn là bản mới nhất
 * (đọc qua ref) nên không cần bọc `useCallback`.
 */
export function useUnsavedChanges(o: {
  dirty: boolean;
  saving?: boolean;
  canSave?: boolean;
  onSave: () => void | Promise<unknown>;
  onReset: () => void;
  description?: string;
  bar?: boolean;
}): void {
  const id = useId();
  const ref = useRef(o);
  ref.current = o;
  const { dirty, saving = false, canSave = true, bar = true } = o;

  useLeaveGuard({
    dirty,
    shouldBlock: shouldBlockNavigation,
    description: o.description ?? DEFAULT_DESCRIPTION,
  });

  useEffect(() => {
    if (!bar) return;
    useUnsavedStore.getState().set(id, {
      dirty,
      saving,
      canSave,
      save: () => ref.current.onSave(),
      reset: () => ref.current.onReset(),
    });
  }, [id, bar, dirty, saving, canSave]);

  // Gỡ mục khi form unmount (đổi mục/đổi trang) để thanh không treo.
  useEffect(() => () => useUnsavedStore.getState().remove(id), [id]);
}
