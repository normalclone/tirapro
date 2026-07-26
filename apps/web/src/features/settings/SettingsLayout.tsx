import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Building2, Shield, Bell, Flag, SignalHigh, ListChecks, GitBranch, KeyRound, AlarmClock } from 'lucide-react';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { WorkspaceBrandingPanel } from '@/features/workspace/WorkspaceBrandingPanel';
import { PrioritiesSection } from '@/features/settings-admin/PrioritiesSection';
import { CustomFieldsAdminSection } from '@/features/settings-admin/CustomFieldsAdminSection';
import { NotificationSection } from './NotificationSection';
import { SeveritySection } from './SeveritySection';

/** Cài đặt được chia nhóm để dễ tìm: chung → con người → cách làm việc → nâng cao. */
const SETTINGS_GROUPS: { group: string; items: { to: string; label: string; hint: string; icon: ReactNode }[] }[] = [
  {
    group: 'Chung',
    items: [
      { to: '/settings/general', label: 'Thương hiệu', hint: 'Tên và logo hiển thị của công ty', icon: <Building2 className="h-4 w-4" /> },
      { to: '/settings/notifications', label: 'Thông báo', hint: 'Chọn việc gì thì báo cho bạn', icon: <Bell className="h-4 w-4" /> },
    ],
  },
  {
    group: 'Con người',
    items: [
      { to: '/settings/roles', label: 'Vai trò & quyền', hint: 'Ai được làm gì trong hệ thống', icon: <Shield className="h-4 w-4" /> },
    ],
  },
  {
    group: 'Cách làm việc',
    items: [
      { to: '/settings/workflows', label: 'Quy trình', hint: 'Các bước một công việc đi qua', icon: <GitBranch className="h-4 w-4" /> },
      { to: '/settings/priorities', label: 'Mức ưu tiên', hint: 'Việc nào cần làm trước', icon: <SignalHigh className="h-4 w-4" /> },
      { to: '/settings/severities', label: 'Mức nghiêm trọng', hint: 'Lỗi ảnh hưởng nặng hay nhẹ', icon: <Flag className="h-4 w-4" /> },
      { to: '/settings/fields', label: 'Trường thông tin thêm', hint: 'Thông tin riêng của công ty cần lưu', icon: <ListChecks className="h-4 w-4" /> },
    ],
  },
  {
    group: 'Nâng cao',
    items: [
      { to: '/settings/response-time', label: 'Cam kết thời gian', hint: 'Hạn phải phản hồi và xử lý xong', icon: <AlarmClock className="h-4 w-4" /> },
      { to: '/settings/api', label: 'API & kết nối lập trình', hint: 'Khoá API cho phần mềm khác dùng', icon: <KeyRound className="h-4 w-4" /> },
    ],
  },
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
        {SETTINGS_GROUPS.map((g) => (
          <div key={g.group} className="contents lg:block lg:pb-1">
            <p className="hidden px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-faint lg:block">{g.group}</p>
            {g.items.map((item) => (
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
          </div>
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
