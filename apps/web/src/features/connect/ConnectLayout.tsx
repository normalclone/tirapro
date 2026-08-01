import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Plug, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TruncatedLabel } from '@/components/ui/TruncatedLabel';

/**
 * Khung "Kết nối & tự động hoá" — gom hai việc cùng bản chất "để hệ thống tự chạy":
 * nối với công cụ bên ngoài, và tự sinh công việc theo lịch/mẫu.
 */
const CONNECT_NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/connect/integrations', label: 'Ứng dụng bên ngoài', icon: <Plug className="h-4 w-4" /> },
  { to: '/connect/automation', label: 'Tự động hoá', icon: <Repeat className="h-4 w-4" /> },
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
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-primary-subtle text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink',
              )
            }
          >
            <span className="shrink-0">{item.icon}</span>
            <TruncatedLabel text={item.label} />
          </NavLink>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
