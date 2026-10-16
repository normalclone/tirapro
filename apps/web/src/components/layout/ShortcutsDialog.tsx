import { Keyboard } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Dialog } from '@/components/ui/Dialog';
import { orderedGroups, shortcutsOf } from '@/lib/shortcuts';

/** Sự kiện mở bảng phím tắt (phát từ hotkey `?` hoặc bảng lệnh). */
export const SHORTCUTS_EVENT = 'tirapro:shortcuts';

/**
 * Bảng phím tắt toàn cục — mở bằng `?` hoặc từ bảng lệnh (sự kiện `tirapro:shortcuts`).
 * Đọc từ kho `lib/shortcuts.ts` (cùng nguồn với trang tài liệu và tooltip); nhóm khớp màn hiện tại xếp đầu, có nhãn "đang dùng".
 * Chỉ đọc; đóng bằng Esc / bấm nền / nút đóng.
 */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Phím tắt"
      icon={<Keyboard className="h-4 w-4" />}
    >
      <div className="space-y-5 py-1">
        {orderedGroups(pathname).map((group) => (
          <section key={group.scope}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-faint">
              {group.title}
              {group.current && (
                <span className="rounded bg-primary-subtle px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  đang dùng
                </span>
              )}
            </h3>
            <ul className="space-y-1.5">
              {shortcutsOf(group.scope).map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-ink">{it.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {(it.display ?? it.keys).map((k, i) => (
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
    </Dialog>
  );
}
