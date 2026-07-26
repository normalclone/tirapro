import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/**
 * Khung modal dùng chung cho các hộp thoại của tab Kiểm thử: nền mờ, thoát bằng Esc,
 * header có tiêu đề + nút đóng, footer cho hành động chính.
 */
export function ModalShell({
  open,
  title,
  onClose,
  footer,
  children,
  size = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  size?: 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex max-h-[84vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200',
          size === 'lg' ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="text-sm font-medium text-ink">{title}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** Nhãn + gợi ý cho một trường trong modal. */
export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint"> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** Textarea thống nhất kiểu dáng với Input (không có primitive riêng trong hệ). */
export const textareaClass =
  'w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-base text-ink outline-none placeholder:text-faint transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]';
