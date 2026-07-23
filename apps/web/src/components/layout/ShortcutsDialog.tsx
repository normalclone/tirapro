import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Sự kiện mở bảng phím tắt (phát từ hotkey `?` hoặc bảng lệnh). */
export const SHORTCUTS_EVENT = 'tirapro:shortcuts';

/** Một dòng phím tắt: mô tả + các phím (mỗi phần tử là 1 <kbd>). */
const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Chung',
    items: [
      { keys: ['⌘', 'K'], label: 'Mở bảng lệnh' },
      { keys: ['/'], label: 'Tìm kiếm / bảng lệnh' },
      { keys: ['c'], label: 'Tạo issue' },
      { keys: ['?'], label: 'Bảng phím tắt này' },
    ],
  },
  {
    title: 'Đi tới (trong dự án)',
    items: [
      { keys: ['g', 'b'], label: 'Board' },
      { keys: ['g', 'l'], label: 'Backlog' },
      { keys: ['g', 'd'], label: 'Tổng quan' },
    ],
  },
];

/**
 * Bảng phím tắt toàn cục — mở bằng `?` hoặc từ bảng lệnh (sự kiện `tirapro:shortcuts`).
 * Chỉ đọc; đóng bằng Esc / bấm nền / nút đóng.
 */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[10vh]">
      <button
        className="absolute inset-0 bg-black/30 animate-in fade-in duration-200"
        onClick={onClose}
        aria-label="Đóng"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Phím tắt"
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200"
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Keyboard className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-sm font-medium text-ink">Phím tắt</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="space-y-5 px-5 py-4">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-xs font-medium text-faint">{group.title}</h3>
              <ul className="space-y-1.5">
                {group.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-ink">{it.label}</span>
                    <span className="flex items-center gap-1">
                      {it.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="min-w-[1.5rem] rounded bg-surface-2 px-1.5 py-0.5 text-center font-mono text-xs text-muted"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
