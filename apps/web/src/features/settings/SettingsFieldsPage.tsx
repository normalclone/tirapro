import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { CustomFieldsAdminSection } from '@/features/settings-admin/CustomFieldsAdminSection';
import { SETTINGS_LABELS } from '@/lib/navLabels';

export const SettingsFieldsPage = () => (
  <PageFrame size="sm">
    <PageHeader
      title={SETTINGS_LABELS.fields}
      description="Thêm ô thông tin riêng vào mỗi công việc; kiểu dữ liệu không đổi được sau khi tạo."
    />
    <CustomFieldsAdminSection />
  </PageFrame>
);
