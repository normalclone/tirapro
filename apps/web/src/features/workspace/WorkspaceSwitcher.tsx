import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMyWorkspaces, useSwitchWorkspace, type MyWorkspace } from './api';
import { CreateWorkspaceModal } from './CreateWorkspaceModal';

/**
 * Nút chọn workspace ở THANH NAVBAR (góc trái): mở popover liệt kê workspace (tên + vai trò),
 * đánh dấu cái đang hoạt động, đổi & về màn Tổng quan của workspace mới khi chọn, tạo workspace mới.
 * Trigger gọn 1 dòng để vừa chiều cao navbar; tên ẩn trên màn nhỏ (chỉ còn badge + mũi tên).
 */
export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const activeId = useAuth((s) => s.workspaceId);
  const { data: workspaces = [] } = useMyWorkspaces();
  const switchWs = useSwitchWorkspace();

  const active: MyWorkspace | undefined = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const label = active?.name ?? 'Tirapro';

  function pick(ws: MyWorkspace) {
    if (ws.id === active?.id) {
      setOpen(false);
      return;
    }
    switchWs.mutate(ws.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={switchWs.isPending}
            aria-label={`Workspace hiện tại: ${label}. Bấm để đổi hoặc tạo mới.`}
            className={cn(
              'flex h-9 max-w-[220px] items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-surface-2',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-surface-2',
              switchWs.isPending && 'opacity-60',
            )}
          >
            <WsBadge name={active?.name ?? 'P'} src={active?.avatarUrl} variant="active" />
            <span className="hidden min-w-0 truncate text-sm font-semibold tracking-tight text-ink-strong sm:block">{label}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="z-dropdown w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <ul className="max-h-80 overflow-y-auto py-1" role="listbox" aria-label="Danh sách workspace">
              {workspaces.map((ws) => {
                const isActive = ws.id === active?.id;
                return (
                  <li key={ws.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      disabled={switchWs.isPending}
                      onClick={() => pick(ws)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                        'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none',
                        'disabled:pointer-events-none disabled:opacity-50',
                        isActive && 'bg-primary-subtle/60',
                      )}
                    >
                      <WsBadge name={ws.name} src={ws.avatarUrl} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-strong">{ws.name}</span>
                        <span className="block truncate text-[11px] text-muted">{ws.roleName}</span>
                      </span>
                      {isActive && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" />
              Tạo workspace
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

/** Ô vuông bo góc: hiện logo workspace nếu có, không thì chữ cái đầu. */
function WsBadge({ name, src, variant }: { name: string; src?: string | null; variant?: 'active' }) {
  return (
    <span
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md text-xs font-bold',
        variant === 'active' ? 'bg-primary text-primary-fg' : 'bg-surface-2 font-semibold text-muted',
      )}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
