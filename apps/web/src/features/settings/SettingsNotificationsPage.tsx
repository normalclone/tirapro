import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { DocsLink } from '@/components/ui/DocsLink';
import { NotificationSection } from './NotificationSection';
import { SETTINGS_LABELS } from '@/lib/navLabels';

export const SettingsNotificationsPage = () => (
  <PageFrame size="sm">
    <PageHeader
      title={SETTINGS_LABELS.notifications}
      description={
        <>
          Mặc định yên tĩnh — chỉ bật thông báo quan trọng. <DocsLink anchor="thong-bao" />
        </>
      }
    />
    <NotificationSection />
  </PageFrame>
);
