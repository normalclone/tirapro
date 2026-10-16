import { useEffect, useRef } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import { useConfirm } from '@/components/ui/useConfirm';

/**
 * Chặn rời trang khi còn thay đổi chưa lưu: điều hướng trong app (sidebar, breadcrumb, Back) hỏi "Bỏ thay đổi?",
 * đóng tab/F5 dùng hộp của trình duyệt. `shouldBlock` (tuỳ chọn) loại các điều hướng nội bộ không cần hỏi.
 * Đồng ý bỏ thì gọi `onDiscard` (vd xoá bản nháp tự lưu) rồi cho đi tiếp.
 */
export function useLeaveGuard(opts: {
  dirty: boolean;
  shouldBlock?: BlockerFunction;
  description: string;
  onDiscard?: () => void;
}): void {
  const confirm = useConfirm();
  const ref = useRef(opts);
  ref.current = opts;
  const blocker = useBlocker(
    (args) => ref.current.dirty && (ref.current.shouldBlock?.(args) ?? true),
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({
      title: 'Bỏ các thay đổi chưa lưu?',
      description: ref.current.description,
      confirmLabel: 'Bỏ thay đổi',
      destructive: true,
    }).then((ok) => {
      if (!ok) return blocker.reset();
      ref.current.onDiscard?.();
      blocker.proceed();
    });
  }, [blocker, confirm]);
  useEffect(() => {
    if (!opts.dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [opts.dirty]);
}
