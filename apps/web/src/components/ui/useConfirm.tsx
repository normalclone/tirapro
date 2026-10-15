import { create } from 'zustand';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Nhãn nút đồng ý — mặc định "Xoá" khi `destructive`, ngược lại "Đồng ý". */
  confirmLabel?: string;
  /** Thao tác không hoàn tác được → nút đỏ, focus ban đầu rơi vào "Huỷ". */
  destructive?: boolean;
}

interface ConfirmState {
  open: boolean;
  /** Giữ lại cả khi đã đóng để nội dung không biến mất giữa chừng hiệu ứng đóng. */
  opts: ConfirmOptions | null;
  resolve: ((ok: boolean) => void) | null;
}

export const useConfirmStore = create<ConfirmState>(() => ({
  open: false,
  opts: null,
  resolve: null,
}));

function settle(ok: boolean) {
  const { resolve } = useConfirmStore.getState();
  useConfirmStore.setState({ open: false, resolve: null });
  resolve?.(ok);
}

/** Hộp đang CHỜ mở (đã gọi `ask` nhưng chưa tới lượt mở): để gọi `ask` lần nữa kịp huỷ nó. */
let pendingOpen: { timer: ReturnType<typeof setTimeout>; resolve: (ok: boolean) => void } | null =
  null;

/**
 * Hộp chỉ MỞ sau khi sự kiện hiện tại kết thúc (macrotask kế). Gọi `confirm()` ngay trong handler Enter/blur thì hộp mở
 * và focus rơi vào nút xác nhận giữa keydown và keypress → keypress của chính phím Enter đó bấm luôn nút và tự xác nhận
 * mà hộp không kịp hiện. Promise trả về vẫn tới ngay lúc gọi; chỉ phần hiển thị bị hoãn.
 */
function ask(opts: ConfirmOptions): Promise<boolean> {
  // Đang có hộp khác (đang hiện hoặc đang chờ mở) → coi như người dùng bỏ qua hộp cũ.
  if (pendingOpen) {
    clearTimeout(pendingOpen.timer);
    pendingOpen.resolve(false);
    pendingOpen = null;
  }
  useConfirmStore.getState().resolve?.(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingOpen = null;
      useConfirmStore.setState({ open: true, opts, resolve });
    }, 0);
    pendingOpen = { timer, resolve };
  });
}

/**
 * Thay cho `window.confirm`: `if (!(await confirm({ title: 'Xoá…?', destructive: true }))) return;`
 * Cần `<ConfirmHost />` đã mount (AppShell). Trả về `true` khi bấm đồng ý, `false` khi Huỷ / Esc / bấm nền.
 */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  return ask;
}

/** Mount MỘT lần ở khung ứng dụng — vẽ hộp xác nhận cho mọi lời gọi `useConfirm()`. */
export function ConfirmHost(): JSX.Element | null {
  const open = useConfirmStore((s) => s.open);
  const opts = useConfirmStore((s) => s.opts);
  if (!opts) return null;
  const destructive = !!opts.destructive;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) settle(false);
      }}
      title={opts.title}
      description={opts.description}
      size="sm"
      icon={destructive ? <AlertTriangle className="h-4 w-4" /> : undefined}
      iconTone="danger"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => settle(false)} autoFocus={destructive}>
            Huỷ
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            size="sm"
            onClick={() => settle(true)}
            autoFocus={!destructive}
          >
            {opts.confirmLabel ?? (destructive ? 'Xoá' : 'Đồng ý')}
          </Button>
        </>
      }
    />
  );
}
