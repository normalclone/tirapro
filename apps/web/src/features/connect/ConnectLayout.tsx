import { Link } from 'react-router-dom';
import { ArrowLeft, Plug, Repeat } from 'lucide-react';
import { useProjects } from '@/features/projects/api';
import { useScopeParam } from '@/lib/scopeParam';
import { APP_NAV_LABELS, CONNECT_LABELS } from '@/lib/navLabels';
import { NAV_RULES, useVisibleItems, type NavRule } from '@/lib/navAccess';
import { SubNavLayout } from '@/components/layout/SubNavLayout';
import type { SubNavItem } from '@/components/layout/subNavModel';

/**
 * Khung "Kết nối & tự động hoá" — gom hai việc cùng bản chất "để hệ thống tự chạy":
 * nối với công cụ bên ngoài, và tự sinh công việc theo lịch/mẫu.
 */
const CONNECT_NAV: (SubNavItem & { rule?: NavRule })[] = [
  {
    to: '/connect/integrations',
    label: CONNECT_LABELS.integrations,
    icon: <Plug className="h-4 w-4" />,
    rule: NAV_RULES.connectIntegrations,
  },
  {
    to: '/connect/automation',
    label: CONNECT_LABELS.automation,
    icon: <Repeat className="h-4 w-4" />,
  },
];

export function ConnectLayout() {
  const items = useVisibleItems(CONNECT_NAV);
  // Vào từ menu "Thêm" của dự án (?project=<id>) → có lối quay về dự án đó.
  const { data: projects } = useProjects(true);
  const fromId = useScopeParam(projects);
  const fromProject = projects?.find((p) => p.id === fromId);
  return (
    <SubNavLayout
      title={APP_NAV_LABELS.connect}
      ariaLabel="Mục kết nối và tự động hoá"
      groups={[{ items }]}
      basePath="/connect"
      frameSize="sm"
      top={
        fromProject && (
          <Link
            to={`/p/${fromProject.key}/board`}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            Về dự án {fromProject.name}
          </Link>
        )
      }
    />
  );
}
