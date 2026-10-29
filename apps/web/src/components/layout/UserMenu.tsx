import { Fragment } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { useAccountItems } from '@/components/layout/accountItems';
import { Avatar } from '@/components/ui/primitives';

/** Menu người dùng (góc phải trên): tài khoản cá nhân, giao diện, đăng xuất. */
export function UserMenu() {
  const user = useAuth((s) => s.user);
  const items = useAccountItems();

  if (!user) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-surface-2"
          aria-label="Menu người dùng"
        >
          <Avatar name={user.displayName} src={user.avatarUrl} size={28} />
          <span className="hidden max-w-[10rem] truncate text-ink sm:inline">
            {user.displayName}
          </span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-faint sm:inline" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-60 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar name={user.displayName} src={user.avatarUrl} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-strong">{user.displayName}</p>
              <p className="truncate text-xs text-faint">{user.email}</p>
            </div>
          </div>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          {items.map((it) => (
            <Fragment key={it.key}>
              {it.danger && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
              <DropdownMenu.Item
                onSelect={(e) => {
                  if (it.keepOpen) e.preventDefault(); // giữ menu mở để thấy giao diện đổi ngay
                  it.onSelect();
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-surface-2',
                  it.danger ? 'text-danger' : 'text-ink',
                )}
              >
                <it.Icon className={cn('h-4 w-4', !it.danger && 'text-muted')} />
                {it.label}
              </DropdownMenu.Item>
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
