import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bell, BellOff, BellRing, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToggleWatch, useWatchState } from './api';

/** Pill "theo dõi" kiểu đăng ký (YouTube): chưa theo dõi → bấm để theo dõi;
 *  đang theo dõi → mở dropdown có "Bỏ theo dõi". */
const PILL = cn(
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-surface-2 px-4',
  'text-sm font-medium text-ink transition-colors hover:bg-surface-3',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50',
  'data-[state=open]:bg-surface-3',
);

export function WatchButton({ issueId }: { issueId: string }) {
  const { data, isLoading } = useWatchState(issueId);
  const toggle = useToggleWatch(issueId);
  const watching = data?.watching ?? false;
  const busy = isLoading || toggle.isPending;

  async function setWatch(next: boolean) {
    try {
      // useToggleWatch nhận trạng thái HIỆN TẠI rồi tự đảo.
      await toggle.mutateAsync(!next);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  if (!watching) {
    return (
      <button
        type="button"
        onClick={() => void setWatch(true)}
        disabled={busy}
        title="Theo dõi vấn đề này để nhận cập nhật"
        className={PILL}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
        Theo dõi
      </button>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" disabled={busy} title="Đang theo dõi" aria-label="Đang theo dõi — mở tuỳ chọn" className={PILL}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          Đang theo dõi
          <ChevronDown className="-mr-1 h-4 w-4 text-muted" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-52 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
        >
          <DropdownMenu.Item
            onSelect={() => void setWatch(false)}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-danger outline-none transition-colors data-[highlighted]:bg-surface-2"
          >
            <BellOff className="h-4 w-4" />
            Bỏ theo dõi
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
