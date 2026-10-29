import type { ReactNode } from 'react';
import {
  Building2,
  Shield,
  Bell,
  Flag,
  SignalHigh,
  ListChecks,
  GitBranch,
  KeyRound,
  AlarmClock,
  FileUp,
  ScrollText,
} from 'lucide-react';
import type { PermissionKey } from '@tirapro/types';
import { NAV_RULES, useVisibleItems, type NavRule } from '@/lib/navAccess';
import { APP_NAV_LABELS, SETTINGS_LABELS } from '@/lib/navLabels';
import { SubNavLayout } from '@/components/layout/SubNavLayout';
import type { SubNavGroup } from '@/components/layout/subNavModel';
import { useCan } from '@/features/projects/permissions';

/** Cài đặt được chia nhóm để dễ tìm: chung → con người → cách làm việc → nâng cao. */
const SETTINGS_GROUPS: {
  group: string;
  items: {
    to: string;
    label: string;
    icon: ReactNode;
    /** Chỉ hiện khi có quyền này. */ permission?: PermissionKey;
    /** Luật hiện mục theo vai trò (U7) — kết hợp với `permission`. */ rule?: NavRule;
  }[];
}[] = [
  {
    group: 'Chung',
    items: [
      {
        to: '/settings/general',
        label: SETTINGS_LABELS.general,
        icon: <Building2 className="h-4 w-4" />,
        rule: NAV_RULES.settingsGeneral,
      },
      {
        to: '/settings/notifications',
        label: SETTINGS_LABELS.notifications,
        icon: <Bell className="h-4 w-4" />,
      },
    ],
  },
  {
    group: 'Con người',
    items: [
      { to: '/settings/roles', label: SETTINGS_LABELS.roles, icon: <Shield className="h-4 w-4" /> },
      {
        to: '/settings/audit',
        label: SETTINGS_LABELS.audit,
        icon: <ScrollText className="h-4 w-4" />,
        permission: 'workspace:admin',
      },
    ],
  },
  {
    group: 'Cách làm việc',
    items: [
      {
        to: '/settings/workflows',
        label: SETTINGS_LABELS.workflows,
        icon: <GitBranch className="h-4 w-4" />,
      },
      {
        to: '/settings/priorities',
        label: SETTINGS_LABELS.priorities,
        icon: <SignalHigh className="h-4 w-4" />,
      },
      {
        to: '/settings/severities',
        label: SETTINGS_LABELS.severities,
        icon: <Flag className="h-4 w-4" />,
      },
      {
        to: '/settings/fields',
        label: SETTINGS_LABELS.fields,
        icon: <ListChecks className="h-4 w-4" />,
      },
    ],
  },
  {
    group: 'Nâng cao',
    items: [
      {
        to: '/settings/response-time',
        label: SETTINGS_LABELS.responseTime,
        icon: <AlarmClock className="h-4 w-4" />,
      },
      {
        to: '/settings/import',
        label: SETTINGS_LABELS.import,
        icon: <FileUp className="h-4 w-4" />,
        rule: NAV_RULES.settingsImport,
      },
      {
        to: '/settings/api',
        label: SETTINGS_LABELS.api,
        icon: <KeyRound className="h-4 w-4" />,
        rule: NAV_RULES.settingsApi,
      },
    ],
  },
];

export function SettingsLayout() {
  const can = useCan(); // phản ứng khi quyền workspace đổi
  const permitted = useVisibleItems(SETTINGS_GROUPS.flatMap((g) => g.items));
  // Lọc quyền/luật vai trò TRƯỚC khi đưa cho SubNavLayout (rail và danh sách mobile dùng chung kết quả này).
  const groups: SubNavGroup[] = SETTINGS_GROUPS.map((g) => ({
    label: g.group,
    items: g.items.filter((i) => permitted.includes(i) && (!i.permission || can(i.permission))),
  })).filter((g) => g.items.length > 0);
  return (
    <SubNavLayout
      title={APP_NAV_LABELS.settings}
      ariaLabel="Mục cài đặt"
      groups={groups}
      basePath="/settings"
      frameSize="sm"
    />
  );
}
