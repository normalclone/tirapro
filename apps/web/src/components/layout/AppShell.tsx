import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Sparkles,
  ShieldCheck,
  ArrowLeft,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { WorkspaceSwitcher } from '@/features/workspace/WorkspaceSwitcher';
import { GuideLauncher } from '@/features/guides/GuideLauncher';
import { AssistantButton, AssistantHost } from '@/features/assistant/AssistantPanel';
import { useNotificationRealtime } from '@/lib/realtime';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { UserMenu } from '@/components/layout/UserMenu';
import { FloatingActions } from '@/components/layout/FloatingActions';
import { BottomTabBar } from '@/components/layout/BottomTabBar';
import { CreateDialogsHost } from '@/components/layout/createActions';
import { LeaveGuardHost } from '@/components/layout/LeaveGuardHost';
import { UnsavedBar } from '@/components/layout/UnsavedBar';
import { MaintenanceBanner } from '@/components/layout/MaintenanceBanner';
import { ConnectionBanner } from '@/components/layout/ConnectionBanner';
import { ShortcutsDialog } from '@/components/layout/ShortcutsDialog';
import { useShellEffects } from '@/components/layout/useShellEffects';
import { ADMIN_NAV, NAV_ITEMS } from '@/components/layout/navItems';
import { Button } from '@/components/ui/Button';
import { ConfirmHost } from '@/components/ui/useConfirm';
import { IssueActionHost } from '@/features/issues/menu/IssueActionHost';
import { useAi } from '@/stores/ai';
import { useAuth } from '@/stores/auth';
import { useSidebar } from '@/stores/sidebar';
import { useIsSystemAdmin, useVisibleItems } from '@/lib/navAccess';
import { useGlobalHotkeys } from '@/lib/useGlobalHotkeys';
import { DESKTOP_MIN_QUERY } from '@/lib/bottomBar';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { TruncatedLabel } from '@/components/ui/TruncatedLabel';

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  // Chế độ menu admin chỉ cho admin hệ thống — người khác mở /admin thấy trang "không có quyền" trong khung thường.
  const isSysAdmin = useIsSystemAdmin();
  const admin = isSysAdmin && (loc.pathname === '/admin' || loc.pathname.startsWith('/admin/'));
  const visibleNav = useVisibleItems(NAV_ITEMS, loc.pathname);
  const navItems = admin ? ADMIN_NAV : visibleNav;
  useNotificationRealtime();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Từ `lg`: sidebar tĩnh + nút nổi. Dưới `lg` (điện thoại + máy tính bảng): thanh tab đáy + sheet, KHÔNG drawer/hamburger/nút nổi.
  const desktop = useMediaQuery(DESKTOP_MIN_QUERY);
  const aiEnabled = useAi((s) => s.enabled);
  const toggleAi = useAi((s) => s.toggle);

  // Thu gọn/mở rộng thanh trái: nhớ theo tài khoản (nạp lại khi đổi tài khoản).
  const userId = useAuth((s) => s.user?.id);
  const collapsed = useSidebar((s) => s.collapsed);
  const toggleSidebar = useSidebar((s) => s.toggle);
  useEffect(() => useSidebar.getState().hydrate(userId), [userId]);

  // Phím tắt toàn cục (c, /, g b/l/d, ?).
  useGlobalHotkeys();

  useShellEffects({ setShortcutsOpen });

  return (
    <div className="flex h-full print:block print:h-auto">
      {/* Sidebar: chỉ từ `lg` (dưới `lg` đã có thanh tab đáy — BottomTabBar). */}
      <aside
        id="app-sidebar"
        aria-label="Điều hướng chính"
        className={cn(
          'hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 print:hidden lg:flex',
          collapsed ? 'w-14' : 'w-48',
        )}
      >
        <div
          className={cn('flex h-[52px] items-center gap-2', collapsed ? 'justify-center' : 'px-4')}
        >
          <div
            className={cn(
              'grid h-6 w-6 place-items-center rounded-md text-xs font-bold',
              admin ? 'bg-ink-strong text-bg' : 'bg-primary text-primary-fg',
            )}
          >
            {admin ? <ShieldCheck className="h-3.5 w-3.5" /> : 'T'}
          </div>
          {!collapsed && (
            <span className="font-semibold tracking-tight text-ink-strong">
              {admin ? 'Quản trị' : 'Tirapro'}
            </span>
          )}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2" data-tour="nav-main">
          {admin && (
            <>
              <NavItem
                to="/"
                active={false}
                icon={<ArrowLeft className="h-4 w-4" />}
                label="Về ứng dụng"
                collapsed={collapsed}
              />
              <div className="my-1.5 border-t border-border" />
            </>
          )}
          {navItems.map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              active={item.match(loc.pathname)}
              icon={<item.Icon className="h-4 w-4" />}
              label={item.label}
              collapsed={collapsed}
            />
          ))}
        </nav>
        <div
          className={cn(
            'flex items-center gap-1 border-t border-border p-2 text-xs text-faint',
            collapsed ? 'flex-col' : 'justify-between',
          )}
          data-tour="cmdk-hint"
        >
          {!collapsed && (
            <span>
              <kbd className="kbd-hint rounded bg-surface-2 px-1.5 py-0.5 font-mono">⌘K</kbd> lệnh
              nhanh
            </span>
          )}
          <button
            type="button"
            onClick={() => toggleSidebar(userId)}
            aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            title={collapsed ? 'Mở rộng thanh điều hướng ( [ )' : 'Thu gọn thanh điều hướng ( [ )'}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4 print:hidden">
          {/* Admin đứng trên mọi nơi → không có bộ chọn/nhãn không gian làm việc ở thanh trên. */}
          {!admin && <WorkspaceSwitcher />}
          <div className="min-w-0 flex-1 truncate text-sm text-muted" data-tour="topbar-context" />
          <div className="flex items-center gap-2">
            {/* Dưới `lg` không còn nút nổi "Lệnh nhanh" → lối vào Bảng lệnh/tìm kiếm nằm ở đây (cùng sự kiện với nút nổi). */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Tìm và chạy lệnh nhanh"
              data-tour="cmdk-hint"
              onClick={() => window.dispatchEvent(new Event('tirapro:command'))}
            >
              <Search className="h-5 w-5" />
            </Button>
            {/* Trợ lý AI gắn với không gian làm việc → chỉ hiện ngoài ngữ cảnh admin. */}
            {!admin && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleAi}
                aria-pressed={aiEnabled}
                title={aiEnabled ? 'Trợ lý AI: Bật — bấm để tắt' : 'Trợ lý AI: Tắt — bấm để bật'}
                className={cn(aiEnabled ? 'text-primary' : 'text-faint')}
              >
                <Sparkles className="h-4 w-4" />
                <span className="sr-only">{aiEnabled ? 'Tắt trợ lý AI' : 'Bật trợ lý AI'}</span>
              </Button>
            )}
            {/* Trợ lý Tirapro (chat cơ bản, không gọi AI ngoài) — cùng điều kiện hiện với nút trợ lý AI. */}
            {!admin && <AssistantButton />}
            {/* Hướng dẫn màn + thông báo dùng chung mọi ngữ cảnh (kể cả admin). */}
            <GuideLauncher />
            {/* Dưới `lg` chuông + menu người dùng đã có trên thanh tab đáy (ô Thông báo, Tôi) → ẩn để khỏi lặp.
                Admin không có ô Thông báo trên thanh → chuông ở lại. */}
            <span
              className={cn('inline-flex', !admin && 'max-lg:hidden')}
              data-tour="topbar-notifications"
            >
              <NotificationBell />
            </span>
            <span className="inline-flex max-lg:hidden">
              <UserMenu />
            </span>
          </div>
        </header>
        <div className="print:hidden">
          <MaintenanceBanner />
          <ConnectionBanner />
        </div>
        {/* scrollbar-gutter:stable — nội dung căn giữa không lệch ngang giữa trang dài (có scrollbar) và trang ngắn */}
        <main className="relative min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable] print:overflow-visible">
          {children}
        </main>
        {/* Hai con flex cuối của cột (dưới <main>): thanh "chưa lưu" rồi thanh tab đáy. Không `fixed` nên không che nội dung. */}
        <UnsavedBar />
        {!desktop && <BottomTabBar admin={admin} />}
      </div>

      {/* `contents`: không thêm hộp vào flex của khung; `print:hidden` ẩn cả nút nổi lẫn hộp thoại khi in. */}
      {!admin && (
        <div className="contents print:hidden">
          {desktop && <FloatingActions />}
          <CreateDialogsHost />
          <AssistantHost />
        </div>
      )}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {/* Hộp xác nhận dùng chung cho useConfirm() — chỉ mount một lần. */}
      <ConfirmHost />
      {/* Hành động ghi từ menu công việc (chuột phải / nút "…") — sống lâu hơn menu. */}
      <IssueActionHost />
      {/* Bộ chặn rời trang duy nhất (useBlocker + beforeunload) cho mọi useLeaveGuard. */}
      <LeaveGuardHost />
    </div>
  );
}

function NavItem({
  to,
  active,
  icon,
  label,
  collapsed,
}: {
  to: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  /** Thu gọn: chỉ còn biểu tượng; tên đi vào tooltip + nhãn truy cập. */
  collapsed?: boolean;
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-md py-2 text-sm font-medium transition-colors',
        collapsed ? 'justify-center px-0' : 'px-3',
        active ? 'bg-primary-subtle text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <TruncatedLabel text={label} />}
    </Link>
  );
}
