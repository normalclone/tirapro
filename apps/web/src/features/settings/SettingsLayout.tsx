import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Building2, UserPlus, Shield, Bell, Flag, SignalHigh, ListChecks, GitBranch, KeyRound } from 'lucide-react';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { WorkspaceBrandingPanel } from '@/features/workspace/WorkspaceBrandingPanel';
import { InvitePanel } from '@/features/workspace/InvitePanel';
import { PrioritiesSection } from '@/features/settings-admin/PrioritiesSection';
import { CustomFieldsAdminSection } from '@/features/settings-admin/CustomFieldsAdminSection';
import { NotificationSection } from './NotificationSection';
import { SeveritySection } from './SeveritySection';

/** Các mục con của Cài đặt (submenu). */
const SETTINGS_NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/settings/general', label: 'Thương hiệu', icon: <Building2 className="h-4 w-4" /> },
  { to: '/settings/members', label: 'Mời thành viên', icon: <UserPlus className="h-4 w-4" /> },
  { to: '/settings/roles', label: 'Vai trò', icon: <Shield className="h-4 w-4" /> },
  { to: '/settings/notifications', label: 'Thông báo', icon: <Bell className="h-4 w-4" /> },
  { to: '/settings/severities', label: 'Mức độ', icon: <Flag className="h-4 w-4" /> },
  { to: '/settings/priorities', label: 'Độ ưu tiên', icon: <SignalHigh className="h-4 w-4" /> },
  { to: '/settings/fields', label: 'Trường tuỳ chỉnh', icon: <ListChecks className="h-4 w-4" /> },
  { to: '/settings/workflows', label: 'Quy trình', icon: <GitBranch className="h-4 w-4" /> },
  { to: '/settings/api', label: 'API & MCP', icon: <KeyRound className="h-4 w-4" /> },
];

export function SettingsLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Submenu: rail dọc trên desktop, hàng pill cuộn ngang trên mobile */}
      <nav
        aria-label="Mục cài đặt"
        className={cn(
          'shrink-0 border-border bg-surface',
          'flex gap-1 overflow-x-auto border-b px-3 py-2',
          'lg:w-60 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5',
        )}
      >
        <h1 className="hidden px-3 pb-2 text-xs font-semibold text-faint lg:block">
          Cài đặt
        </h1>
        {SETTINGS_NAV.map((item) => (
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

/** Container chuẩn cho một trang con của cài đặt. */
function PageShell({ children }: { children: ReactNode }) {
  return <div className={pageContainer('sm')}>{children}</div>;
}

export const SettingsGeneralPage = () => (
  <PageShell>
    <WorkspaceBrandingPanel />
  </PageShell>
);
export const SettingsMembersPage = () => (
  <PageShell>
    <InvitePanel />
  </PageShell>
);
export const SettingsNotificationsPage = () => (
  <PageShell>
    <NotificationSection />
  </PageShell>
);
export const SettingsSeveritiesPage = () => (
  <PageShell>
    <SeveritySection />
  </PageShell>
);
export const SettingsPrioritiesPage = () => (
  <PageShell>
    <PrioritiesSection />
  </PageShell>
);
export const SettingsFieldsPage = () => (
  <PageShell>
    <CustomFieldsAdminSection />
  </PageShell>
);
