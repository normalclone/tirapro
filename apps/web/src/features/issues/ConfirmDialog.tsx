import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { RequireTextField, useRequireText } from '@/components/ui/RequireText';

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
  requireText,
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
  /** Thao tác không đảo được: nút xác nhận chỉ bật khi người dùng gõ đúng chữ này (xem `useConfirm`). */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const text = useRequireText(requireText);
  const { reset } = text;
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requireText]);
  const needsText = text.required;
  const confirm = () => {
    if (text.matches && !loading) onConfirm();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={title}
      description={description}
      size="sm"
      icon={danger ? <AlertTriangle className="h-4 w-4" /> : undefined}
      iconTone="danger"
      onSubmit={confirm}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} autoFocus={danger && !needsText}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            size="sm"
            loading={loading}
            onClick={onConfirm}
            disabled={!text.matches}
            autoFocus={!danger && !needsText}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {needsText && requireText && (
        <RequireTextField expected={requireText} text={text} onEnter={confirm} />
      )}
    </Dialog>
  );
}
