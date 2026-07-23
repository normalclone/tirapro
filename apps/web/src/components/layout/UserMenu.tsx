import { useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { BookOpen, ChevronDown, LogOut, Moon, ShieldCheck, Sun, UserCircle } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/stores/theme';
import { Avatar } from '@/components/ui/primitives';

/** Menu người dùng (góc phải trên): tài khoản cá nhân, giao diện, đăng xuất. */
export function UserMenu() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

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
          <span className="hidden max-w-[10rem] truncate text-ink sm:inline">{user.displayName}</span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-faint sm:inline" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-60 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar name={user.displayName} src={user.avatarUrl} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-strong">{user.displayName}</p>
              <p className="truncate text-xs text-faint">{user.email}</p>
            </div>
          </div>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <DropdownMenu.Item
            onSelect={() => navigate('/account')}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2"
          >
            <UserCircle className="h-4 w-4 text-muted" />
            Tài khoản
          </DropdownMenu.Item>

          <DropdownMenu.Item
            onSelect={() => navigate('/documentation')}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2"
          >
            <BookOpen className="h-4 w-4 text-muted" />
            Tài liệu
          </DropdownMenu.Item>

          {user.isSystemAdmin && (
            <DropdownMenu.Item
              onSelect={() => navigate('/admin')}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2"
            >
              <ShieldCheck className="h-4 w-4 text-muted" />
              Admin hệ thống
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Item
            onSelect={(e) => {
              e.preventDefault(); // giữ menu mở để thấy giao diện đổi ngay
              toggle();
            }}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4 text-muted" /> : <Moon className="h-4 w-4 text-muted" />}
            {theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <DropdownMenu.Item
            onSelect={() => void logout()}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-danger outline-none transition-colors data-[highlighted]:bg-surface-2"
          >
            <LogOut className="h-4 w-4" />
            Đăng xuất
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
