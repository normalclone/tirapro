import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { CustomFieldsAdminSection } from '@/features/settings-admin/CustomFieldsAdminSection';
import { SETTINGS_LABELS } from '@/lib/navLabels';

export const SettingsFieldsPage = () => (
  <PageFrame size="sm">
    <PageHeader
      title={SETTINGS_LABELS.fields}
      description="Thêm các ô thông tin riêng của bạn vào mỗi công việc. Không thể đổi kiểu dữ liệu của trường sau khi tạo."
    />
    <CustomFieldsAdminSection />
  </PageFrame>
);
