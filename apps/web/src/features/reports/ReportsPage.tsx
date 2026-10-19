import { useParams } from 'react-router-dom';
import { useProject } from '@/features/projects/api';
import { Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { FlowTab } from './FlowTab';
import { OverviewTab } from './OverviewTab';
import { QaReportPanel } from './QaReportPanel';
import { SprintTab } from './SprintTab';
import { REPORT_TABS, useReportTab } from './tabs';

/** Vỏ trang Báo cáo: thanh tab + nội dung theo tab (`?tab=`), mỗi tab chỉ tải dữ liệu của chính nó. */
export function ReportsPage() {
  const { key = '' } = useParams();
  const { data: project, isError, error, refetch } = useProject(key);
  const [tab, setTab] = useReportTab();

  if (isError) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-6 py-3">
          <span className="text-sm font-medium text-ink">Báo cáo</span>
        </div>
        <div className="p-6">
          <QueryError error={error} onRetry={() => void refetch()} />
        </div>
      </div>
    );
  }

  const projectId = project?.id;

  return (
    <div className="flex h-full flex-col overflow-y-auto print:block print:h-auto print:overflow-visible">
      <Tabs
        idBase="report"
        ariaLabel="Loại báo cáo"
        value={tab}
        onChange={setTab}
        items={REPORT_TABS.map((t) => ({ id: t.id, label: t.label, title: t.hint }))}
        fade
        className="shrink-0 overflow-x-auto px-4 pt-2 scrollbar-none print:hidden"
      />

      <TabPanel idBase="report" value={tab} className="space-y-4 p-4">
        {!projectId ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-[300px]" />
            ))}
          </div>
        ) : tab === 'sprint' ? (
          <SprintTab projectId={projectId} projectKey={project.key} />
        ) : tab === 'overview' ? (
          <OverviewTab project={project} />
        ) : tab === 'flow' ? (
          <FlowTab projectId={projectId} />
        ) : tab === 'qa' ? (
          <QaReportPanel projectId={projectId} />
        ) : null}
      </TabPanel>
    </div>
  );
}
