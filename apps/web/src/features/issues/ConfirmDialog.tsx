import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

/**
 * Hộp thoại xác nhận điều khiển bằng state (có trạng thái `loading` cho nút đồng ý) — dùng khi thao
 * tác chạy API ngay trong lúc xác nhận. Với xác nhận một lần (thay window.confirm) dùng `useConfirm()`.
 * Dựng trên `Dialog` chung: focus-trap, Esc/click nền để huỷ, trả focus về nút mở.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Xoá',
  cancelLabel = 'Huỷ',
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} autoFocus={danger}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" loading={loading} onClick={onConfirm} autoFocus={!danger}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
