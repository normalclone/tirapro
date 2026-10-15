import { Keyboard } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';

/** Sự kiện mở bảng phím tắt (phát từ hotkey `?` hoặc bảng lệnh). */
export const SHORTCUTS_EVENT = 'tirapro:shortcuts';

/** Một dòng phím tắt: mô tả + các phím (mỗi phần tử là 1 <kbd>). */
const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Chung',
    items: [
      { keys: ['⌘', 'K'], label: 'Mở bảng lệnh' },
      { keys: ['/'], label: 'Tìm kiếm / bảng lệnh' },
      { keys: ['c'], label: 'Tạo công việc' },
      { keys: ['w'], label: 'Ghi thời gian (trong chi tiết công việc)' },
      { keys: ['m'], label: 'Viết bình luận (trong chi tiết công việc)' },
      { keys: ['?'], label: 'Bảng phím tắt này' },
    ],
  },
  {
    title: 'Đi tới (trong dự án)',
    items: [
      { keys: ['g', 'b'], label: 'Bảng việc' },
      { keys: ['g', 'l'], label: 'Việc chờ (backlog)' },
      { keys: ['g', 'd'], label: 'Tổng quan' },
    ],
  },
];

/**
 * Bảng phím tắt toàn cục — mở bằng `?` hoặc từ bảng lệnh (sự kiện `tirapro:shortcuts`).
 * Chỉ đọc; đóng bằng Esc / bấm nền / nút đóng.
 */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    </Dialog>
  );
}
