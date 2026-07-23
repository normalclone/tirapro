import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Hộp thoại xác nhận có style (thay cho window.confirm) — dùng khi thao tác không thể hoàn tác
 * qua Undo (vd BE chưa có endpoint khôi phục). Focus-trap + Esc/click nền để huỷ (Radix Dialog).
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
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-modal bg-black/30 animate-in fade-in duration-150" />
        <Dialog.Content
          onEscapeKeyDown={onCancel}
          className="fixed left-1/2 top-1/2 z-modal w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex gap-3">
            {danger && (
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger/10 text-danger" aria-hidden>
                <AlertTriangle className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-sm font-semibold text-ink-strong">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
              )}
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>{cancelLabel}</Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              size="sm"
              loading={loading}
              onClick={onConfirm}
              autoFocus
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
