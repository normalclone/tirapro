import { useMemo } from 'react';
import { CircleDot } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { dirtyEntries, summarizeDirty, useUnsavedStore } from '@/stores/unsaved';

/**
 * Thanh "thay đổi chưa lưu" dùng chung: con flex của cột nội dung (giữa <main> và thanh tab đáy), không `fixed`
 * nên không che nội dung. Hiện khi có form đăng ký qua `useUnsavedChanges` đang dirty; Lưu/Bỏ áp cho mọi mục dirty.
 * `lg:pr-24` chừa chỗ cho nút nổi "Tạo" (fixed góc phải-dưới) ở desktop.
 */
export function UnsavedBar() {
  const entries = useUnsavedStore((s) => s.entries);
  const { count, canSave, saving } = useMemo(() => summarizeDirty(entries), [entries]);
  if (count === 0) return null;

  function discard() {
    for (const [, e] of dirtyEntries(useUnsavedStore.getState().entries)) e.reset();
  }
  function saveAll() {
    for (const [, e] of dirtyEntries(useUnsavedStore.getState().entries)) void e.save();
  }

  return (
    <div
      role="region"
      aria-label="Thay đổi chưa lưu"
      className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-4 py-2.5 shadow-[0_-2px_8px_oklch(0.4_0.03_256/0.06)] duration-base animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none lg:pr-24 print:hidden"
    >
      <CircleDot className="h-4 w-4 shrink-0 text-warning-ink" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
        Có thay đổi chưa lưu
      </span>
      <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>
        Bỏ thay đổi
      </Button>
      <Button size="sm" onClick={saveAll} loading={saving} disabled={!canSave}>
        Lưu
      </Button>
    </div>
  );
}
