import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Dialog, type DialogProps } from '@/components/ui/Dialog';
import { useConfirm } from '@/components/ui/useConfirm';

/**
 * Hộp thoại "Thêm …" của màn danh sách (thay cho form tạo mở sẵn/mở bung ngay trên trang). Nút "Thêm …" ở đầu danh sách mở nó;
 * form bên trong giữ nguyên trường/kiểm tra/quyền. Khác `Dialog` thường ở ba điểm:
 *  - đóng (Esc/X/bấm nền) trả focus về nút đã mở nó;
 *  - còn nội dung đang nhập (`dirty`) thì hỏi trước khi đóng (dùng chung `useConfirm`);
 *  - luôn dựng với `open` thật (hợp đồng Dialog) — chỗ dùng không bọc điều kiện.
 * Gửi thành công: chỗ dùng gọi `onClose()` (không hỏi vì lúc đó không còn `dirty`) và tự báo toast.
 */
export function AddDialog({
  open,
  onClose,
  dirty = false,
  dirtyPrompt,
  children,
  ...dialog
}: {
  open: boolean;
  onClose: () => void;
  /** Có nội dung chưa lưu → hỏi trước khi đóng. */
  dirty?: boolean;
  /** Lời hỏi riêng khi đóng lúc còn `dirty` (mặc định: "Bạn đang nhập dở…"). */
  dirtyPrompt?: { title: string; description: string; confirmLabel?: string };
  children: ReactNode;
} & Omit<DialogProps, 'open' | 'onOpenChange' | 'children' | 'onCloseAutoFocus'>) {
  const confirm = useConfirm();
  const opener = useRef<HTMLElement | null>(null);
  // Layout effect chạy trước khi Radix chuyển focus vào hộp → nhớ đúng nút đã mở.
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);

  async function requestClose() {
    if (dirty) {
      const ok = await confirm({
        title: dirtyPrompt?.title ?? 'Bỏ thay đổi chưa lưu?',
        description:
          dirtyPrompt?.description ?? 'Bạn đang nhập dở. Đóng bây giờ sẽ mất phần đã nhập.',
        confirmLabel: dirtyPrompt?.confirmLabel ?? 'Bỏ thay đổi',
        destructive: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  return (
    <Dialog
      {...dialog}
      open={open}
      onOpenChange={(o) => {
        if (!o) void requestClose();
      }}
      onCloseAutoFocus={(e) => {
        const el = opener.current;
        if (el && el.isConnected) {
          e.preventDefault();
          el.focus();
        }
      }}
    >
      {children}
    </Dialog>
  );
}
