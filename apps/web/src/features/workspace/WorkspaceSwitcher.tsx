import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronsUpDown, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useConfirmLeaveApp } from '@/lib/useLeaveGuard';
import { useMyWorkspaces, useSwitchWorkspace, type MyWorkspace } from './api';
import { CreateWorkspaceModal } from './CreateWorkspaceModal';
import { WorkspaceOption, WsBadge } from './WorkspaceOption';

/**
 * Nút chọn không gian làm việc ở THANH NAVBAR (góc trái): mở popover liệt kê các nơi (tên + vai trò),
 * đánh dấu nơi đang hoạt động, đổi & về màn Tổng quan của nơi mới khi chọn, lập nơi mới.
 * Trigger gọn 1 dòng để vừa chiều cao navbar; tên ẩn trên màn nhỏ (chỉ còn badge + mũi tên).
 */
export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const activeId = useAuth((s) => s.workspaceId);
  const { data: workspaces = [] } = useMyWorkspaces();
  const switchWs = useSwitchWorkspace();

  const active: MyWorkspace | undefined =
    workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const label = active?.name ?? 'Tirapro';

  const confirmLeave = useConfirmLeaveApp();

  async function pick(ws: MyWorkspace) {
    if (ws.id === active?.id) {
      setOpen(false);
      return;
    }
    // Hỏi TRƯỚC khi đổi: sau khi mutate thành công token đã bị thay, hỏi lúc tải lại là muộn.
    setOpen(false);
    if (!(await confirmLeave())) return;
    switchWs.mutate(ws.id, {
      // Lỗi: nháp chưa bị bỏ (chỉ bỏ khi đổi thành công, trong useSwitchWorkspace) nên chỉ cần báo lỗi.
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={switchWs.isPending}
            aria-label={`Không gian làm việc hiện tại: ${label}. Bấm để đổi sang nơi khác hoặc lập nơi mới.`}
            className={cn(
              'flex h-9 max-w-[220px] items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-surface-2',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-surface-2',
              switchWs.isPending && 'opacity-60',
            )}
          >
            <WsBadge name={active?.name ?? 'P'} src={active?.avatarUrl} variant="active" />
            <span className="hidden min-w-0 truncate text-sm font-semibold tracking-tight text-ink-strong sm:block">
              {label}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="z-dropdown w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <ul
              className="max-h-80 overflow-y-auto py-1"
              role="listbox"
              aria-label="Danh sách không gian làm việc"
            >
              {workspaces.map((ws) => (
                <WorkspaceOption
                  key={ws.id}
                  ws={ws}
                  active={ws.id === active?.id}
                  disabled={switchWs.isPending}
                  onPick={(w) => void pick(w)}
                />
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                // Hỏi TRƯỚC khi mở hộp tạo (tạo xong sẽ tải lại trang) — không hỏi chồng lên hộp đang mở.
                void confirmLeave().then((ok) => ok && setCreateOpen(true));
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" />
              Tạo không gian làm việc
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
