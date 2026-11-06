import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { DocsLink } from '@/components/ui/DocsLink';
import { NotificationSection } from './NotificationSection';
import { ProjectTelegramSection } from './ProjectTelegramSection';
import { TelegramLinkCard } from './TelegramLinkCard';
import { SETTINGS_LABELS } from '@/lib/navLabels';

export const SettingsNotificationsPage = () => (
  <PageFrame size="sm">
    <PageHeader
      data-tour="notif-settings-header"
      title={SETTINGS_LABELS.notifications}
      description={
        <>
          Mặc định yên tĩnh — chỉ bật thông báo quan trọng. <DocsLink anchor="thong-bao" />
        </>
      }
    />
    <div className="space-y-5">
      <TelegramLinkCard />
      <NotificationSection />
      <ProjectTelegramSection />
    </div>
  </PageFrame>
);
