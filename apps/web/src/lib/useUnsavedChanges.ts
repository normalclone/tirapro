import { useCallback, useEffect, useId, useRef } from 'react';
import { useConfirm } from '@/components/ui/useConfirm';
import { shouldBlockNavigation } from '@/lib/unsavedChanges';
import { useLeaveGuard } from '@/lib/useLeaveGuard';
import { dirtyEntries, useUnsavedStore } from '@/stores/unsaved';

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

/**
 * Gọi trước khi đổi tab-state trong trang (không đi qua router nên `useBlocker` không bắt):
 * còn mục dirty → hỏi "Bỏ các thay đổi chưa lưu?". Trả `true` nếu được đi tiếp (đã reset các mục dirty).
 */
export function useConfirmDiscard(): () => Promise<boolean> {
  const confirm = useConfirm();
  return useCallback(async () => {
    const dirty = dirtyEntries(useUnsavedStore.getState().entries);
    if (dirty.length === 0) return true;
    const ok = await confirm({
      title: 'Bỏ các thay đổi chưa lưu?',
      description: DEFAULT_DESCRIPTION,
      confirmLabel: 'Bỏ thay đổi',
      destructive: true,
    });
    if (!ok) return false;
    for (const [, e] of dirty) e.reset();
    return true;
  }, [confirm]);
}
