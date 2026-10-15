import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Building2,
  Check,
  Copy,
  KeyRound,
  LogOut,
  MoreHorizontal,
  UserCheck,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { AddToWorkspaceDialog } from './AddToWorkspaceDialog';
import {
  useResetAdminPassword,
  useRevokeAdminSessions,
  useUpdateAdminUser,
  type AdminUser,
} from './api';

const ITEM =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-surface-2';

/** Menu ⋯ của một tài khoản: đặt lại mật khẩu, đăng xuất mọi thiết bị, vô hiệu hoá / kích hoạt lại. */
export function AccountActionsMenu({ user }: { user: AdminUser }) {
  const confirm = useConfirm();
  const update = useUpdateAdminUser();
  const reset = useResetAdminPassword();
  const revoke = useRevokeAdminSessions();
  const [temp, setTemp] = useState<{ open: boolean; password: string }>({
    open: false,
    password: '',
  });
  // Hộp thoại chỉ dựng từ lần mở đầu tiên (mỗi dòng đều có menu này — không tải danh sách workspace cho mọi dòng).
  const [addOpen, setAddOpen] = useState(false);
  const [addMounted, setAddMounted] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(clearTimer.current), []);
  const resetMutation = reset.reset;
  useEffect(() => resetMutation, [resetMutation]);

  const deactivated = user.status === 'DEACTIVATED';

  function closeTemp() {
    setTemp((t) => ({ ...t, open: false }));
    // Mật khẩu tạm chỉ hiện một lần: xoá khỏi state sau khi hiệu ứng đóng kết thúc.
    clearTimer.current = setTimeout(() => setTemp({ open: false, password: '' }), 300);
    resetMutation();
  }

  async function onReset() {
    const ok = await confirm({
      title: `Đặt lại mật khẩu của ${user.displayName}?`,
      description:
        'Hệ thống tạo một mật khẩu tạm và chỉ hiện cho bạn một lần. Mật khẩu cũ mất hiệu lực và họ bị đăng xuất khỏi mọi thiết bị.',
      confirmLabel: 'Đặt lại mật khẩu',
      destructive: true,
    });
    if (!ok) return;
    reset.mutate(user.id, {
      onSuccess: (r) => {
        clearTimeout(clearTimer.current);
        setTemp({ open: true, password: r.tempPassword });
      },
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  async function onRevoke() {
    const ok = await confirm({
      title: `Đăng xuất ${user.displayName} khỏi mọi thiết bị?`,
      description:
        'Họ bị đăng xuất ngay trên mọi trình duyệt và thiết bị, rồi phải đăng nhập lại. Mật khẩu và dữ liệu giữ nguyên.',
      confirmLabel: 'Đăng xuất',
      destructive: true,
    });
    if (!ok) return;
    revoke.mutate(user.id, {
      onSuccess: () => toast.success(`Đã đăng xuất ${user.displayName} khỏi mọi thiết bị`),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  async function onDeactivate() {
    const ok = await confirm({
      title: `Vô hiệu hoá tài khoản của ${user.displayName}?`,
      description:
        'Họ bị đăng xuất khỏi mọi thiết bị và không đăng nhập được; lịch sử công việc giữ nguyên. Bạn có thể kích hoạt lại sau.',
      confirmLabel: 'Vô hiệu hoá',
      destructive: true,
    });
    if (!ok) return;
    update.mutate(
      { id: user.id, patch: { status: 'DEACTIVATED' } },
      {
        onSuccess: () => toast.success(`Đã vô hiệu hoá ${user.displayName}`),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function onReactivate() {
    update.mutate(
      { id: user.id, patch: { status: 'ACTIVE' } },
      {
        onSuccess: () => toast.success(`Đã kích hoạt lại ${user.displayName}`),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Thao tác với tài khoản ${user.displayName}`}
            title="Thao tác"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            collisionPadding={12}
            sideOffset={4}
            className="z-dropdown w-64 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
          >
            <DropdownMenu.Item
              className={ITEM}
              onSelect={() => {
                setAddMounted(true);
                setAddOpen(true);
              }}
            >
              <Building2 className="h-4 w-4 shrink-0 text-muted" /> Thêm vào không gian làm việc…
            </DropdownMenu.Item>
            <DropdownMenu.Item className={ITEM} onSelect={() => void onReset()}>
              <KeyRound className="h-4 w-4 shrink-0 text-muted" /> Đặt lại mật khẩu
            </DropdownMenu.Item>
            <DropdownMenu.Item className={ITEM} onSelect={() => void onRevoke()}>
              <LogOut className="h-4 w-4 shrink-0 text-muted" /> Đăng xuất mọi thiết bị
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            {deactivated ? (
              <DropdownMenu.Item className={ITEM} onSelect={onReactivate}>
                <UserCheck className="h-4 w-4 shrink-0 text-muted" /> Kích hoạt lại
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item
                className={`${ITEM} text-danger data-[highlighted]:bg-danger/10`}
                onSelect={() => void onDeactivate()}
              >
                <UserX className="h-4 w-4 shrink-0" /> Vô hiệu hoá tài khoản
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {addMounted && (
        <AddToWorkspaceDialog user={user} open={addOpen} onClose={() => setAddOpen(false)} />
      )}
      <TempPasswordDialog
        open={temp.open}
        name={user.displayName}
        password={temp.password}
        onClose={closeTemp}
      />
    </>
  );
}

function TempPasswordDialog({
  open,
  name,
  password,
  onClose,
}: {
  open: boolean;
  name: string;
  password: string;
  onClose: () => void;
}) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Mật khẩu tạm"
      size="md"
    >
      <div className="space-y-3">
        <p className="text-sm text-ink">
          Đã đặt lại mật khẩu của {name}. Gửi mật khẩu tạm này cho họ — chỉ hiện một lần, đóng hộp
          này là mất:
        </p>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={password}
            className="font-mono"
            aria-label="Mật khẩu tạm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={() => void copy(password)}
            aria-label="Sao chép"
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            Xong
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
