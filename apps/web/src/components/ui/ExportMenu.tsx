import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './Button';

export interface ExportMenuItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

/** Nút "Xuất" + danh sách định dạng. Mỗi mục là một thao tác bất đồng bộ; lỗi hiện toast. */
export function ExportMenu({
  items,
  disabled,
  className,
}: {
  items: ExportMenuItem[];
  disabled?: boolean;
  /** Lớp thêm cho nút (vd `CHIP_TOUCH_HIT` khi nút nằm trong dải chip cuộn ngang). */
  className?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  // Khi đang tải KHÔNG `disabled` trigger: Radix trả focus về trigger sau khi chọn mục, nút disabled sẽ làm focus rơi
  // về body (người dùng bàn phím mất vị trí). Thay vào đó `aria-busy` + bỏ qua lựa chọn mới.
  async function onSelect(item: ExportMenuItem) {
    if (busy) return;
    setBusy(item.id);
    try {
      await item.run();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Xuất dữ liệu"
          disabled={disabled}
          aria-busy={busy !== null}
          className={cn('print:hidden', className)}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="h-4 w-4" aria-hidden />
          )}
          Xuất
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          collisionPadding={12}
          sideOffset={6}
          className="z-dropdown w-56 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150 print:hidden"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              onSelect={() => void onSelect(item)}
              className="flex cursor-pointer flex-col rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2"
            >
              {item.label}
              {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
