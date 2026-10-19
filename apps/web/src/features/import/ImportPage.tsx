import { Link } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { pageContainer } from '@/components/layout/page';
import { SectionCard } from '@/components/ui/SectionCard';
import { JiraImportWizard } from './JiraImportWizard';
import { SETTINGS_LABELS } from '@/lib/navLabels';

/** Trang "Nhập dữ liệu" trong Cài đặt — hiện có nhập từ Jira (CSV). */
export function ImportPage() {
  return (
    <div className={pageContainer('lg')}>
      <SectionCard
        icon={<FileUp className="h-4 w-4" />}
        title={SETTINGS_LABELS.import}
        description="Chuyển công việc từ Jira sang Tirapro bằng tệp CSV: ghép loại, trạng thái, mức ưu tiên và người dùng rồi nhập theo lô."
      >
        <JiraImportWizard />
      </SectionCard>
      <p className="mt-4 text-sm text-muted">
        Muốn nhập CSV đơn giản hoặc JSON export của Tirapro vào một dự án có sẵn? Vào{' '}
        <Link to="/projects" className="text-primary hover:underline">
          Dự án
        </Link>{' '}
        → Cài đặt dự án → Xuất / Nhập dữ liệu.
      </p>
    </div>
  );
}
