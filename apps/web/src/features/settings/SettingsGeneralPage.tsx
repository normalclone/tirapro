import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { OrganizationBrandingPanel } from '@/features/organization/OrganizationBrandingPanel';
import { SETTINGS_LABELS } from '@/lib/navLabels';

export const SettingsGeneralPage = () => (
  <PageFrame size="sm">
    <PageHeader
      data-tour="settings-general-header"
      title={SETTINGS_LABELS.general}
      description="Logo của tổ chức bạn."
    />
    <OrganizationBrandingPanel />
  </PageFrame>
);
