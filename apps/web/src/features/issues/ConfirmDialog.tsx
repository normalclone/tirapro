import { useRef, useState } from 'react';
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
  // Giữ chữ yêu cầu cuối cùng trong lúc hiệu ứng đóng (người gọi thường xoá đối tượng ngay khi đóng) → ô và nút không đổi.
  const lastRequireText = useRef(requireText);
  if (requireText) lastRequireText.current = requireText;
  const shownText = requireText ?? lastRequireText.current;
  // Số lần mở: chữ đã gõ gắn với số này nên mở lại luôn trống ngay commit đầu.
  const [seq, setSeq] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSeq((n) => n + 1);
  }
  const text = useRequireText(shownText, seq);
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
      onSubmit={needsText ? confirm : undefined}
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
      {needsText && shownText && (
        <RequireTextField expected={shownText} text={text} onEnter={confirm} />
      )}
    </Dialog>
  );
}
