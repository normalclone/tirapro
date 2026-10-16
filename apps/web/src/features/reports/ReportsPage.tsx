import { useRef, type KeyboardEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useProject } from '@/features/projects/api';
import { Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { cn } from '@/lib/utils';
import { FlowTab } from './FlowTab';
import { OverviewTab } from './OverviewTab';
import { SprintTab } from './SprintTab';
import { REPORT_TABS, useReportTab } from './tabs';

/** Vỏ trang Báo cáo: thanh tab + nội dung theo tab (`?tab=`), mỗi tab chỉ tải dữ liệu của chính nó. */
export function ReportsPage() {
  const { key = '' } = useParams();
  const { data: project, isError, error, refetch } = useProject(key);
  const [tab, setTab] = useReportTab();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  /** Mũi tên trái/phải, Home/End chuyển tab như tablist chuẩn (tab đang chọn là điểm dừng Tab duy nhất). */
  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = REPORT_TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % REPORT_TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + REPORT_TABS.length) % REPORT_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = REPORT_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(REPORT_TABS[next]!.id);
    tabRefs.current[next]?.focus();
  }

  const projectId = project?.id;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 pt-2"
        role="tablist"
        aria-label="Loại báo cáo"
        onKeyDown={onTabKeyDown}
      >
        {REPORT_TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`report-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="report-panel"
            tabIndex={tab === t.id ? 0 : -1}
            title={t.hint}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              tab === t.id
                ? 'border-primary text-ink-strong'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="report-panel"
        aria-labelledby={`report-tab-${tab}`}
        className="space-y-4 p-4"
      >
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
        ) : null}
      </div>
    </div>
  );
}
