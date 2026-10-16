import { useEffect, useLayoutEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

export interface LightboxItem {
  id: string;
  name: string;
}

/**
 * Xem ảnh phóng to trên `Dialog` chung (giữ hiệu ứng đóng, Radix trả focus về nút đã mở): ←/→ đổi ảnh (cuộn vòng),
 * Esc đóng, nút Tải xuống. Không biết ảnh lấy từ đâu — nơi dùng truyền `renderImage` (blob có token, File vừa dán…).
 */
export function Lightbox({
  open,
  items,
  index,
  onIndexChange,
  onOpenChange,
  renderImage,
  onDownload,
}: {
  open: boolean;
  items: LightboxItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
  renderImage: (item: LightboxItem) => ReactNode;
  onDownload?: (item: LightboxItem) => void;
}) {
  const count = items.length;
  const current = items[index];
  // Phần tử đang giữ focus lúc mở (thumbnail / ảnh nhúng) — Esc trả focus về đó. Chụp ở layout effect, TRƯỚC khi
  // Radix chuyển focus vào hộp (effect thường của nó chạy sau).
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);
  const go = (delta: number) => count > 1 && onIndexChange((index + delta + count) % count);

  // Nghe ở document để ←/→ chạy cả khi focus đang ở nút Đóng (nằm ngoài vùng nội dung của hộp).
  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      onIndexChange((index + (e.key === 'ArrowRight' ? 1 : -1) + count) % count);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, count, index, onIndexChange]);

  // Dialog render qua portal nhưng sự kiện React vẫn nổi lên tổ tiên React của Lightbox (vd khung mô tả `onClick={sửa}`,
  // dòng việc mở panel): chặn ở đây để mọi click/phím TRONG lightbox không kích hoạt gì ngoài nó.
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <span style={{ display: 'contents' }} onClick={stop} onKeyDown={stop}>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Xem ảnh ${current?.name ?? ''}`.trim()}
        hideTitle
        className="outline-none"
        // Focus vào khung hộp (không nhảy sang nút "Ảnh trước" làm hiện vòng focus ngay khi mở bằng chuột); Tab vẫn đi tiếp tới nút.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.target as HTMLElement | null)?.focus?.({ preventScroll: true });
        }}
        onCloseAutoFocus={(e) => {
          const el = opener.current;
          if (el && el.isConnected && el !== document.body) {
            e.preventDefault();
            el.focus({ preventScroll: true });
          }
        }}
        size="xl"
        bodyClassName="p-0"
        footer={
          <>
            <span className="mr-auto min-w-0 truncate text-sm text-ink" title={current?.name}>
              {current?.name}
              {count > 1 && (
                <span className="tabular ml-2 text-xs text-faint">{`${index + 1} / ${count}`}</span>
              )}
            </span>
            {onDownload && current && (
              <Button variant="secondary" size="sm" onClick={() => onDownload(current)}>
                <Download className="h-4 w-4" />
                Tải xuống
              </Button>
            )}
          </>
        }
      >
        <div className="relative grid min-h-[40dvh] place-items-center bg-surface-2 p-3">
          {current && renderImage(current)}
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Ảnh trước"
                className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface text-ink shadow-md transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Ảnh sau"
                className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface text-ink shadow-md transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </>
          )}
        </div>
      </Dialog>
    </span>
  );
}
