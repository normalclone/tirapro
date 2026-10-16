import { pickDefaultSprint } from '@/features/reports/burndown';
import { BurndownChart } from '@/features/reports/charts';
import { useBurndown, useProjectSprints } from '@/features/reports/api';
import { cfgString } from '../widgetConfig';
import { queryWidgetState, type WidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

/** Burndown của sprint đang chạy trong dự án (không có sprint chạy → sprint kết thúc gần nhất). */
export function BurndownWidget({ title, config }: WidgetProps) {
  const projectId = cfgString(config, 'projectId');
  const sprints = useProjectSprints(projectId);
  const sprint = sprints.data ? pickDefaultSprint(sprints.data) : undefined;
  const burndown = useBurndown(sprint?.id, projectId);

  if (!projectId) {
    return <WidgetFrame title={title} state="empty" emptyText="Chọn dự án cho ô này" />;
  }

  let state: WidgetState;
  let active: { error: unknown; refetch: () => unknown } = burndown;
  if (!sprints.data) {
    state = queryWidgetState(sprints);
    active = sprints;
  } else if (!sprint) {
    state = 'empty';
  } else {
    state = queryWidgetState(burndown, (d) => d.series.length === 0);
  }

  return (
    <WidgetFrame
      title={title}
      state={state}
      error={active.error}
      onRetry={() => void active.refetch()}
      emptyText={
        sprints.data && !sprint
          ? 'Dự án chưa có sprint'
          : 'Chưa có dữ liệu burndown — sprint cần ngày bắt đầu và kết thúc'
      }
    >
      {burndown.data && sprint && (
        <>
          <p className="mb-1 text-xs text-muted">
            {sprint.name} · điểm còn lại theo ngày so với đường lý tưởng
          </p>
          <BurndownChart report={burndown.data} closed={sprint.state === 'CLOSED'} />
        </>
      )}
    </WidgetFrame>
  );
}
