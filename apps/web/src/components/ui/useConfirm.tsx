import { create } from 'zustand';
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

const useConfirmStore = create<ConfirmState>(() => ({ open: false, opts: null, resolve: null }));

function settle(ok: boolean) {
  const { resolve } = useConfirmStore.getState();
  useConfirmStore.setState({ open: false, resolve: null });
  resolve?.(ok);
}

function ask(opts: ConfirmOptions): Promise<boolean> {
  // Đang có hộp xác nhận khác → coi như người dùng bỏ qua hộp cũ.
  useConfirmStore.getState().resolve?.(false);
  return new Promise<boolean>((resolve) => {
    useConfirmStore.setState({ open: true, opts, resolve });
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
