import { useCallback, useEffect, useId, useRef } from 'react';
import { type BlockerFunction } from 'react-router-dom';
import { useConfirm } from '@/components/ui/useConfirm';
import { describeGuard, dirtyGuardEntries, useLeaveGuardStore } from '@/stores/leaveGuard';

/**
 * Chặn rời trang khi còn thay đổi chưa lưu: điều hướng trong app (sidebar, breadcrumb, Back) hỏi "Bỏ thay đổi?",
 * đóng tab/F5 dùng hộp của trình duyệt. `shouldBlock` (tuỳ chọn) loại các điều hướng nội bộ không cần hỏi.
 * Đồng ý bỏ thì gọi `onDiscard` (vd xoá bản nháp tự lưu) rồi cho đi tiếp.
 *
 * Hook chỉ ĐĂNG KÝ vào `useLeaveGuardStore`; bộ chặn duy nhất (một `useBlocker` + một `beforeunload`) nằm ở
 * `<LeaveGuardHost />` trong AppShell — router chỉ hỗ trợ một blocker, nhiều hook cùng trang không được tự gọi `useBlocker`.
 */
export function useLeaveGuard(opts: {
  dirty: boolean;
  shouldBlock?: BlockerFunction;
  description: string;
  onDiscard?: () => void;
}): void {
  const id = useId();
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    useLeaveGuardStore.getState().set(id, {
      isDirty: () => ref.current.dirty,
      shouldBlock: (args) => ref.current.shouldBlock?.(args) ?? true,
      description: () => ref.current.description,
      onDiscard: () => ref.current.onDiscard?.(),
    });
    return () => useLeaveGuardStore.getState().remove(id);
  }, [id]);
}

/**
 * Gọi TRƯỚC thao tác sẽ tải lại cả trang (đổi không gian làm việc): còn bất kỳ mục chặn nào dirty (form, nháp wiki,
 * dashboard editor...) → hỏi "Bỏ các thay đổi chưa lưu?". Đồng ý → gọi `onDiscard` từng mục và tạm tắt `beforeunload`
 * (đã hỏi rồi, không hỏi lần hai); nếu thao tác sau đó thất bại, gọi `resumeLeaveGuard()`.
 */
export function useConfirmLeaveApp(): () => Promise<boolean> {
  const confirm = useConfirm();
  return useCallback(async () => {
    const dirty = dirtyGuardEntries(useLeaveGuardStore.getState().entries);
    if (dirty.length === 0) return true;
    const ok = await confirm({
      title: 'Bỏ các thay đổi chưa lưu?',
      description: describeGuard(dirty),
      confirmLabel: 'Bỏ thay đổi',
      destructive: true,
    });
    if (!ok) return false;
    for (const [, e] of dirty) e.onDiscard();
    useLeaveGuardStore.getState().setSuspended(true);
    return true;
  }, [confirm]);
}

/** Thao tác sau `useConfirmLeaveApp` thất bại (không tải lại trang) → bật lại `beforeunload`. */
export function resumeLeaveGuard(): void {
  useLeaveGuardStore.getState().setSuspended(false);
}
