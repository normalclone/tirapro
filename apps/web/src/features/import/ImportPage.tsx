import { Link } from 'react-router-dom';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/ui/SectionCard';
import { JiraImportWizard } from './JiraImportWizard';
import { SETTINGS_LABELS } from '@/lib/navLabels';

/** Trang "Nhập dữ liệu" trong Cài đặt — hiện có nhập từ Jira (CSV). */
export function ImportPage() {
  return (
    <PageFrame size="sm">
      <PageHeader
        title={SETTINGS_LABELS.import}
        description="Chuyển công việc từ Jira sang Tirapro bằng tệp CSV, ghép trường rồi nhập theo lô."
      />
      <SectionCard>
        <JiraImportWizard />
      </SectionCard>
      <p className="mt-4 text-sm text-muted">
        Muốn nhập CSV đơn giản hoặc JSON export của Tirapro vào một dự án có sẵn? Vào{' '}
        <Link to="/projects" className="text-primary hover:underline">
          Dự án
        </Link>{' '}
        → Cài đặt dự án → Xuất / Nhập dữ liệu.
      </p>
    </PageFrame>
  );
}
