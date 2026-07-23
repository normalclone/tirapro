import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, LayoutDashboard, Settings, Plug, Filter, Users, Menu, X, Sparkles, ShieldCheck, Building2, SlidersHorizontal, Activity, ArrowLeft } from 'lucide-react';
import { WorkspaceSwitcher } from '@/features/workspace/WorkspaceSwitcher';
import { GuideLauncher } from '@/features/guides/GuideLauncher';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { UserMenu } from '@/components/layout/UserMenu';
import { FloatingActions } from '@/components/layout/FloatingActions';
import { MaintenanceBanner } from '@/components/layout/MaintenanceBanner';
import { ShortcutsDialog, SHORTCUTS_EVENT } from '@/components/layout/ShortcutsDialog';
import { Button } from '@/components/ui/Button';
import { useAi } from '@/stores/ai';
import { useGlobalHotkeys } from '@/lib/useGlobalHotkeys';
import { cn } from '@/lib/utils';

const NAV_ITEMS: { to: string; label: string; icon: ReactNode; match: (p: string) => boolean }[] = [
  { to: '/', label: 'Tổng quan', icon: <LayoutDashboard className="h-4 w-4" />, match: (p) => p === '/' },
  { to: '/projects', label: 'Dự án', icon: <LayoutGrid className="h-4 w-4" />, match: (p) => p.startsWith('/projects') },
  { to: '/filters', label: 'Bộ lọc', icon: <Filter className="h-4 w-4" />, match: (p) => p.startsWith('/filters') },
  { to: '/members', label: 'Thành viên', icon: <Users className="h-4 w-4" />, match: (p) => p.startsWith('/members') },
  { to: '/integrations', label: 'Tích hợp', icon: <Plug className="h-4 w-4" />, match: (p) => p.startsWith('/integrations') },
  { to: '/settings', label: 'Cài đặt', icon: <Settings className="h-4 w-4" />, match: (p) => p.startsWith('/settings') },
];

// Menu riêng cho Admin hệ thống — đứng trên mọi workspace (không gắn với 1 workspace nào).
const ADMIN_NAV: { to: string; label: string; icon: ReactNode; match: (p: string) => boolean }[] = [
  { to: '/admin', label: 'Tổng quan', icon: <LayoutDashboard className="h-4 w-4" />, match: (p) => p === '/admin' },
  { to: '/admin/workspaces', label: 'Workspaces', icon: <Building2 className="h-4 w-4" />, match: (p) => p.startsWith('/admin/workspaces') },
  { to: '/admin/accounts', label: 'Tài khoản', icon: <Users className="h-4 w-4" />, match: (p) => p.startsWith('/admin/accounts') },
  { to: '/admin/config', label: 'Cấu hình', icon: <SlidersHorizontal className="h-4 w-4" />, match: (p) => p.startsWith('/admin/config') },
  { to: '/admin/system', label: 'Hệ thống', icon: <Activity className="h-4 w-4" />, match: (p) => p.startsWith('/admin/system') },
];

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const admin = loc.pathname === '/admin' || loc.pathname.startsWith('/admin/');
  const navItems = admin ? ADMIN_NAV : NAV_ITEMS;
  const [navOpen, setNavOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const aiEnabled = useAi((s) => s.enabled);
  const toggleAi = useAi((s) => s.toggle);

  // Phím tắt toàn cục (c, /, g b/l/d, ?).
  useGlobalHotkeys();

  // Bảng phím tắt — mở bằng `?` hoặc từ bảng lệnh (sự kiện dùng chung).
  useEffect(() => {
    const onOpen = () => setShortcutsOpen(true);
    window.addEventListener(SHORTCUTS_EVENT, onOpen);
    return () => window.removeEventListener(SHORTCUTS_EVENT, onOpen);
  }, []);

  // Đóng drawer khi đổi route (điều hướng xong là ẩn).
  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  // Esc để đóng + focus nút đóng khi mở (a11y bàn phím trên mobile).
  useEffect(() => {
    if (!navOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className="flex h-full">
      {/* Backdrop (chỉ mobile, khi drawer mở) */}
      {navOpen && (
        <button
          type="button"
          aria-label="Đóng menu"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-nav-backdrop bg-ink/40 backdrop-blur-[1px] lg:hidden"
        />
      )}

      {/* Sidebar: tĩnh trên desktop, drawer trượt trên mobile */}
      <aside
        id="app-sidebar"
        aria-label="Điều hướng chính"
        className={cn(
          'fixed inset-y-0 left-0 z-nav-drawer flex w-64 flex-col border-r border-border bg-surface',
          'transition-transform duration-200 ease-out-quart motion-reduce:transition-none',
          'lg:static lg:z-auto lg:w-48 lg:shrink-0 lg:translate-x-0 lg:shadow-none',
          navOpen ? 'translate-x-0 shadow-lg' : '-translate-x-full',
        )}
      >
        <div className="flex h-[52px] items-center gap-2 px-4">
          <div className={cn('grid h-6 w-6 place-items-center rounded-md text-xs font-bold', admin ? 'bg-ink-strong text-bg' : 'bg-primary text-primary-fg')}>
            {admin ? <ShieldCheck className="h-3.5 w-3.5" /> : 'T'}
          </div>
          <span className="font-semibold tracking-tight text-ink-strong">{admin ? 'Quản trị' : 'Tirapro'}</span>
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon"
            onClick={() => setNavOpen(false)}
            className="ml-auto h-9 w-9 lg:hidden"
            aria-label="Đóng menu"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {admin && (
            <>
              <NavItem to="/" active={false} icon={<ArrowLeft className="h-4 w-4" />}>Về ứng dụng</NavItem>
              <div className="my-1.5 border-t border-border" />
            </>
          )}
          {navItems.map((item) => (
            <NavItem key={item.to} to={item.to} active={item.match(loc.pathname)} icon={item.icon}>
              {item.label}
            </NavItem>
          ))}
        </nav>
        <div className="border-t border-border p-2 text-xs text-faint">
          <kbd className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">⌘K</kbd> lệnh nhanh
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNavOpen(true)}
            className="-ml-1 h-10 w-10 lg:hidden"
            aria-label="Mở menu"
            aria-controls="app-sidebar"
            aria-expanded={navOpen}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {/* Admin đứng trên mọi workspace → không có bộ chọn/nhãn workspace ở thanh trên. */}
          {!admin && <WorkspaceSwitcher />}
          <div className="min-w-0 flex-1 truncate text-sm text-muted" data-tour="topbar-context" />
          <div className="flex items-center gap-2">
            {/* Trợ lý AI gắn với workspace → chỉ hiện ngoài ngữ cảnh admin. */}
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
            {/* Hướng dẫn màn + thông báo dùng chung mọi ngữ cảnh (kể cả admin). */}
            <GuideLauncher />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <MaintenanceBanner />
        {/* scrollbar-gutter:stable — nội dung căn giữa không lệch ngang giữa trang dài (có scrollbar) và trang ngắn */}
        <main className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">{children}</main>
      </div>

      {!admin && <FloatingActions />}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function NavItem({ to, active, icon, children }: { to: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-primary-subtle text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
