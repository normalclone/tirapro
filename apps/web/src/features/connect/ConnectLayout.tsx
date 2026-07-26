import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Plug, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Khung "Kết nối & tự động hoá" — gom hai việc cùng bản chất "để hệ thống tự chạy":
 * nối với công cụ bên ngoài, và tự sinh công việc theo lịch/mẫu.
 */
const CONNECT_NAV: { to: string; label: string; hint: string; icon: ReactNode }[] = [
  { to: '/connect/integrations', label: 'Ứng dụng bên ngoài', hint: 'Telegram, nhập dữ liệu từ Jira, kho mã nguồn', icon: <Plug className="h-4 w-4" /> },
  { to: '/connect/automation', label: 'Tự động hoá', hint: 'Mẫu công việc và công việc lặp lại theo lịch', icon: <Repeat className="h-4 w-4" /> },
];

export function ConnectLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <nav
        aria-label="Mục kết nối và tự động hoá"
        className={cn(
          'shrink-0 border-border bg-surface',
          'flex gap-1 overflow-x-auto border-b px-3 py-2',
          'lg:w-64 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5',
        )}
      >
        <h1 className="hidden px-3 pb-2 text-xs font-semibold text-faint lg:block">Kết nối &amp; tự động hoá</h1>
        {CONNECT_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.hint}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-primary-subtle text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink',
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
