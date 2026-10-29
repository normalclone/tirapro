import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { LinkTabs } from '@/components/ui/LinkTabs';
import { FEATURES } from '@/lib/features';
import { CONNECT_LABELS } from '@/lib/navLabels';
import { DigestsSection } from '@/features/digests/DigestsSection';
import { TelegramSection } from './TelegramSection';
import { RepositorySection } from './RepositorySection';
import {
  integrationPath,
  integrationRedirectTarget,
  integrationTabs,
  parseIntegrationSection,
} from './sections';

const TABS = integrationTabs(FEATURES);

/**
 * Ứng dụng bên ngoài: khung + hàng tab theo route (`/connect/integrations/telegram|repos|digest`). Mỗi mục là một
 * route thật nên Back/chia sẻ URL hoạt động và `LeaveGuardHost` bắt form chưa lưu khi đổi mục (không cần
 * `useConfirmDiscard` thủ công như khi mục chỉ là state).
 */
export function IntegrationsPage() {
  return (
    <PageFrame size="sm">
      <PageHeader title={CONNECT_LABELS.integrations} />
      <LinkTabs ariaLabel="Mục tích hợp" items={TABS} className="mb-6" />
      <Outlet />
    </PageFrame>
  );
}

/** `/connect/integrations` và liên kết cũ `?section=` → route con tương ứng (giữ các query khác). */
export function IntegrationsIndexRedirect() {
  const { search } = useLocation();
  return <Navigate to={integrationRedirectTarget(search, FEATURES)} replace />;
}

/** `/connect/integrations/:section` — mục lạ hoặc bị cờ tắt (Kho mã) → rơi về Telegram. */
export function IntegrationSection() {
  const { section } = useParams();
  const { search } = useLocation();
  const id = parseIntegrationSection(section, FEATURES);
  if (!id) return <Navigate to={{ pathname: integrationPath('telegram'), search }} replace />;
  if (id === 'repos') return <RepositorySection />;
  if (id === 'digest') return <DigestsSection />;
  return <TelegramSection />;
}
