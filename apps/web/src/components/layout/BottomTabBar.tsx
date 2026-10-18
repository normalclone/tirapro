import { forwardRef, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, Plus } from 'lucide-react';
import { Avatar } from '@/components/ui/primitives';
import { useUnreadCount } from '@/features/notifications/api';
import { useAuth } from '@/stores/auth';
import { notificationsTabLabel, unreadBadgeText } from '@/lib/bottomBar';
import { cn } from '@/lib/utils';
import {
  ADMIN_NAV,
  ADMIN_TAB_COUNT,
  NAV_ITEMS,
  sheetNavItems,
  USER_TAB_ICONS,
  USER_TAB_PATHS,
} from '@/components/layout/navItems';
import { CreateSheet, MeSheet } from '@/components/layout/MobileSheets';

/** Ô tab: ô icon cao cố định 28px để nhãn thẳng hàng giữa các ô (vòng tròn 40px của "Tạo" tràn ra ngoài ô icon, không đẩy nhãn). Vùng chạm cả ô (cao 55px + viền trên 1px = 56px `BOTTOM_BAR_PX`, rộng 1/5 màn), icon 20px + nhãn 11px. */
const TAB =
  'relative flex h-[55px] w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]';

function tone(active: boolean) {
  return active ? 'text-primary' : 'text-muted active:text-ink';
}

function TabLink({
  to,
  active,
  label,
  ariaLabel,
  tour,
  children,
}: {
  to: string;
  active: boolean;
  label: string;
  ariaLabel?: string;
  tour?: string;
  children: ReactNode;
}) {
  return (
    <li className="min-w-0 flex-1">
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        aria-label={ariaLabel}
        data-tour={tour}
        className={cn(TAB, tone(active))}
      >
        <span className="grid h-7 place-items-center">{children}</span>
        <span className="max-w-full truncate px-1">{label}</span>
      </Link>
    </li>
  );
}

const TabButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & { label: string; active?: boolean; children: ReactNode }
>(function TabButton({ label, active = false, children, ...rest }, ref) {
  return (
    <li className="min-w-0 flex-1">
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-current={active ? 'true' : undefined}
        {...rest}
        className={cn(TAB, tone(active))}
      >
        <span className="grid h-7 place-items-center">{children}</span>
        <span className="max-w-full truncate px-1">{label}</span>
      </button>
    </li>
  );
});

/**
 * Thanh tab đáy dưới `lg` (thay drawer + hamburger + nút nổi). Con flex CUỐI của cột phải (dưới `<main>`), KHÔNG `fixed`:
 * không che nội dung, `BulkActionBar sticky bottom-0` tự nằm ngay trên thanh. Người dùng thường: Tổng quan · Dự án · Tạo ·
 * Thông báo · Tôi. Admin hệ thống ở `/admin*`: 4 mục admin đầu + Tôi. "Tạo" và "Tôi" mở sheet đáy (không phải route).
 */
export function BottomTabBar({ admin }: { admin: boolean }) {
  const loc = useLocation();
  const path = loc.pathname;
  const user = useAuth((s) => s.user);
  const { data: unread = 0 } = useUnreadCount();
  const [createOpen, setCreateOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const meRef = useRef<HTMLButtonElement>(null);
  // Đóng sheet bằng Esc/chạm nền → trả focus về ô đã mở (sheet mở bằng state nên Radix không có Trigger để trả về).
  // Đóng vì đã chọn việc (đi trang khác / mở hộp thoại) → KHÔNG giành focus.
  const actedRef = useRef(false);
  const returnFocus = (ref: React.RefObject<HTMLButtonElement | null>) => (e: Event) => {
    e.preventDefault();
    if (!actedRef.current) ref.current?.focus();
    actedRef.current = false;
  };

  const userTabs = USER_TAB_PATHS.map((to) => NAV_ITEMS.find((i) => i.to === to)!);
  // Ô "Tôi" sáng khi đang ở một trang mà mục của nó nằm trong sheet (Cài đặt, Thành viên, Tài khoản…).
  const meActive =
    path.startsWith('/account') ||
    path.startsWith('/documentation') ||
    sheetNavItems(admin ? ADMIN_NAV : NAV_ITEMS, admin).some((i) => i.match(path));

  return (
    <>
      <nav
        aria-label="Điều hướng chính"
        data-tour="nav-main"
        className="shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] print:hidden lg:hidden"
      >
        <ul className="flex">
          {admin ? (
            ADMIN_NAV.slice(0, ADMIN_TAB_COUNT).map((i) => (
              <TabLink
                key={i.to}
                to={i.to}
                active={i.match(path)}
                label={i.tabLabel ?? i.label}
                ariaLabel={i.tabLabel ? i.label : undefined}
              >
                <i.Icon className="h-5 w-5" aria-hidden />
              </TabLink>
            ))
          ) : (
            <>
              {userTabs.map((i) => {
                const Icon = USER_TAB_ICONS[i.to] ?? i.Icon;
                return (
                  <TabLink key={i.to} to={i.to} active={i.match(path)} label={i.label}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </TabLink>
                );
              })}
              <TabButton
                ref={createRef}
                label="Tạo"
                onClick={() => setCreateOpen(true)}
                aria-expanded={createOpen}
              >
                <span className="-my-1.5 grid h-10 w-10 place-items-center rounded-full bg-primary-subtle text-primary">
                  <Plus className="h-5 w-5" aria-hidden />
                </span>
              </TabButton>
              <TabLink
                to="/notifications"
                active={path.startsWith('/notifications')}
                label="Thông báo"
                ariaLabel={notificationsTabLabel(unread)}
                tour="topbar-notifications"
              >
                <span className="relative grid place-items-center">
                  <Bell className="h-5 w-5" aria-hidden />
                  {unread > 0 && (
                    <span
                      aria-hidden
                      className="absolute -top-1.5 left-3 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-fg"
                    >
                      {unreadBadgeText(unread)}
                    </span>
                  )}
                </span>
              </TabLink>
            </>
          )}
          <TabButton
            ref={meRef}
            label="Tôi"
            aria-label="Tôi"
            active={meActive}
            onClick={() => setMeOpen(true)}
            aria-expanded={meOpen}
          >
            <span
              className={cn(
                'grid place-items-center rounded-full',
                meActive && 'ring-2 ring-primary ring-offset-1 ring-offset-surface',
              )}
            >
              <Avatar name={user?.displayName ?? '?'} src={user?.avatarUrl} size={24} />
            </span>
          </TabButton>
        </ul>
      </nav>

      <CreateSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onActed={() => (actedRef.current = true)}
        onCloseAutoFocus={returnFocus(createRef)}
      />
      <MeSheet
        open={meOpen}
        onOpenChange={setMeOpen}
        onActed={() => (actedRef.current = true)}
        onCloseAutoFocus={returnFocus(meRef)}
        admin={admin}
      />
    </>
  );
}
