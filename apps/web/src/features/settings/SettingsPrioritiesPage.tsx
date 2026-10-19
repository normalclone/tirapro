import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { PrioritiesSection } from '@/features/settings-admin/PrioritiesSection';
import { SETTINGS_LABELS } from '@/lib/navLabels';

export const SettingsPrioritiesPage = () => (
  <PageFrame size="sm">
    <PageHeader
      title={SETTINGS_LABELS.priorities}
      description="Đặt các mức ưu tiên; số thứ tự càng nhỏ thì càng được làm trước."
    />
    <PrioritiesSection />
  </PageFrame>
);
