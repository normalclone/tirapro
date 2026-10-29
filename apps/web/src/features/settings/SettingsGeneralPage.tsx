import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { WorkspaceBrandingPanel } from '@/features/workspace/WorkspaceBrandingPanel';
import { SETTINGS_LABELS } from '@/lib/navLabels';

export const SettingsGeneralPage = () => (
  <PageFrame size="sm">
    <PageHeader
      title={SETTINGS_LABELS.general}
      description="Logo hiện ở nút chuyển không gian làm việc trên thanh trên cùng."
    />
    <WorkspaceBrandingPanel />
  </PageFrame>
);
