import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/primitives';
import { useCfd, useCreatedResolved } from './api';
import { AXIS_PROPS, Card, ChartSkeleton, LEGEND_STYLE, TOOLTIP_STYLE } from './charts';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';

/** Tab "Luồng công việc": Cumulative Flow và Tạo mới vs Đã xử lý. */
export function FlowTab({ projectId }: { projectId: string }) {
  const cfd = useCfd(projectId);
  const createdResolved = useCreatedResolved(projectId);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Cumulative Flow">
        {cfd.isLoading ? (
          <ChartSkeleton />
        ) : !cfd.data || cfd.data.series.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<LineChartIcon />}
            title="Chưa có dữ liệu"
            description="Biểu đồ dựng từ lịch sử chuyển trạng thái, hiện khi có công việc được tạo hoặc chuyển cột."
          />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={cfd.data.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Area
                type="monotone"
                dataKey="todo"
                name={STATUS_CATEGORY_LABEL.TODO}
                stackId="1"
                stroke="var(--status-todo)"
                fill="var(--status-todo)"
              />
              <Area
                type="monotone"
                dataKey="inProgress"
                name={STATUS_CATEGORY_LABEL.IN_PROGRESS}
                stackId="1"
                stroke="var(--status-progress)"
                fill="var(--status-progress)"
              />
              <Area
                type="monotone"
                dataKey="done"
                name={STATUS_CATEGORY_LABEL.DONE}
                stackId="1"
                stroke="var(--status-done)"
                fill="var(--status-done)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Tạo mới vs Đã xử lý">
        {createdResolved.isLoading ? (
          <ChartSkeleton />
        ) : !createdResolved.data || createdResolved.data.series.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<LineChartIcon />}
            title="Chưa có dữ liệu"
            description="Biểu đồ hiện khi có công việc được tạo hoặc hoàn thành trong khoảng thời gian này."
          />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={createdResolved.data.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Line
                type="monotone"
                dataKey="created"
                name="Tạo mới"
                stroke="var(--status-progress)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="resolved"
                name="Đã xử lý"
                stroke="var(--status-done)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}
