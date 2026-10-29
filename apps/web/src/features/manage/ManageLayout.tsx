import { AlarmClock, Briefcase, CalendarClock, Handshake, ShieldAlert, Target } from 'lucide-react';
import { APP_NAV_LABELS, MANAGE_LABELS } from '@/lib/navLabels';
import { SubNavLayout } from '@/components/layout/SubNavLayout';
import type { SubNavItem } from '@/components/layout/subNavModel';

/**
 * Khung "Danh mục" — gom các màn theo dõi cấp công ty (không thuộc riêng dự án nào)
 * vào một chỗ, thay vì mỗi thứ một mục ngoài thanh bên.
 */
const MANAGE_NAV: SubNavItem[] = [
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
  return (
    <SubNavLayout
      title={APP_NAV_LABELS.manage}
      ariaLabel="Mục danh mục"
      groups={[{ items: MANAGE_NAV }]}
      basePath="/manage"
      frameSize="xl"
    />
  );
}
