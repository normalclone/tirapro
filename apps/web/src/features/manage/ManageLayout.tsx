import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { AlarmClock, Briefcase, CalendarClock, Handshake, ShieldAlert, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TruncatedLabel } from '@/components/ui/TruncatedLabel';

/**
 * Khung "Quản trị" — gom các màn theo dõi cấp công ty (không thuộc riêng dự án nào)
 * vào một chỗ, thay vì mỗi thứ một mục ngoài thanh bên.
 */
const MANAGE_NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/manage/portfolio', label: 'Danh mục dự án', icon: <Briefcase className="h-4 w-4" /> },
  { to: '/manage/goals', label: 'Mục tiêu', icon: <Target className="h-4 w-4" /> },
  { to: '/manage/risks', label: 'Rủi ro & vướng mắc', icon: <ShieldAlert className="h-4 w-4" /> },
  { to: '/manage/resources', label: 'Nhân lực', icon: <CalendarClock className="h-4 w-4" /> },
  { to: '/manage/response-time', label: 'Thời gian xử lý', icon: <AlarmClock className="h-4 w-4" /> },
  { to: '/manage/clients', label: 'Khách hàng', icon: <Handshake className="h-4 w-4" /> },
];

export function ManageLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <nav
        aria-label="Mục quản trị"
        className={cn(
          'shrink-0 border-border bg-surface',
          'flex gap-1 overflow-x-auto border-b px-3 py-2',
          'lg:w-64 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5',
        )}
      >
        <h1 className="hidden px-3 pb-2 text-xs font-semibold text-faint lg:block">Quản trị</h1>
        {MANAGE_NAV.map((item) => (
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
