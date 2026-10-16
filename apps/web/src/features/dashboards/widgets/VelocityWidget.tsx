import { VelocityChart } from '@/features/reports/charts';
import { useVelocity } from '@/features/reports/api';
import { cfgString } from '../widgetConfig';
import { queryWidgetState } from '../widgetState';
import { WidgetFrame } from '../WidgetFrame';
import type { WidgetProps } from './types';

/** Cam kết vs hoàn thành của các sprint đã kết thúc trong dự án. */
export function VelocityWidget({ title, config }: WidgetProps) {
  const projectId = cfgString(config, 'projectId');
  const q = useVelocity(projectId);

  if (!projectId) {
    return <WidgetFrame title={title} state="empty" emptyText="Chọn dự án cho ô này" />;
  }
  const state = queryWidgetState(q, (d) => d.sprints.length === 0);
  return (
    <WidgetFrame
      title={title}
      state={state}
      error={q.error}
      onRetry={() => void q.refetch()}
      emptyText="Velocity hiện sau khi có sprint đầu tiên kết thúc"
    >
      {q.data && <VelocityChart report={q.data} />}
    </WidgetFrame>
  );
}
