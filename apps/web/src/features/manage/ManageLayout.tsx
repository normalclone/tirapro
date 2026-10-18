import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AlarmClock, Briefcase, CalendarClock, Handshake, ShieldAlert, Target } from 'lucide-react';
import { APP_NAV_LABELS, MANAGE_LABELS } from '@/lib/navLabels';
import { cn } from '@/lib/utils';
import { TruncatedLabel } from '@/components/ui/TruncatedLabel';
import { useScrollFade } from '@/lib/useScrollFade';

/**
 * Khung "Danh mục" — gom các màn theo dõi cấp công ty (không thuộc riêng dự án nào)
 * vào một chỗ, thay vì mỗi thứ một mục ngoài thanh bên.
 */
const MANAGE_NAV: { to: string; label: string; icon: ReactNode }[] = [
  {
    to: '/manage/portfolio',
    label: MANAGE_LABELS.portfolio,
    icon: <Briefcase className="h-4 w-4" />,
  },
  { to: '/manage/goals', label: MANAGE_LABELS.goals, icon: <Target className="h-4 w-4" /> },
  { to: '/manage/risks', label: MANAGE_LABELS.risks, icon: <ShieldAlert className="h-4 w-4" /> },
  {
    to: '/manage/resources',
    label: MANAGE_LABELS.resources,
    icon: <CalendarClock className="h-4 w-4" />,
  },
  {
    to: '/manage/response-time',
    label: MANAGE_LABELS.responseTime,
    icon: <AlarmClock className="h-4 w-4" />,
  },
  { to: '/manage/clients', label: MANAGE_LABELS.clients, icon: <Handshake className="h-4 w-4" /> },
];

export function ManageLayout() {
  const { pathname } = useLocation();
  const navFade = useScrollFade<HTMLElement>(pathname, '[aria-current="page"]');
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <nav
        aria-label="Mục danh mục"
        ref={navFade.ref}
        style={navFade.style}
        className={cn(
          'shrink-0 border-border bg-surface',
          'scroll-fade-x relative flex gap-1 overflow-x-auto border-b px-3 py-2 max-lg:scrollbar-none',
          'lg:w-64 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5',
        )}
      >
        <h1 className="hidden px-3 pb-2 text-xs font-semibold text-faint lg:block">
          {APP_NAV_LABELS.manage}
        </h1>
        {MANAGE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-subtle text-primary'
                  : 'text-muted hover:bg-surface-2 hover:text-ink',
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
