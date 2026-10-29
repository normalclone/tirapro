import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { SeveritySection } from './SeveritySection';
import { SETTINGS_LABELS } from '@/lib/navLabels';

export const SettingsSeveritiesPage = () => (
  <PageFrame size="sm">
    <PageHeader
      title={SETTINGS_LABELS.severities}
      description="Đặt các mức nghiêm trọng; số thứ tự càng nhỏ thì mức càng nặng, xử lý trước."
    />
    <SeveritySection />
  </PageFrame>
);
