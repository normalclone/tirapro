import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { SprintSummaryReport } from '@tirapro/shared';
import type { SprintDto } from '@tirapro/types';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { QueryError } from '@/components/ui/QueryError';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { fetchAllProjectIssues } from '@/features/issues/api';
import { fmtDate } from '@/lib/dateFormat';
import { downloadText } from '@/lib/download';
import { keys } from '@/lib/queryKeys';
import { sprintTimeInfo } from '@/lib/sprintTime';
import { useBurndown, useProjectSprints, useSprintSummary, useVelocity } from './api';
import { orderSprints, resolveSprint, SPRINT_STATE_LABEL } from './burndown';
import {
  BurndownChart,
  Card,
  ChartSkeleton,
  StatStrip,
  VelocityChart,
  type StatItem,
} from './charts';
import { SprintSummaryPanel } from './SprintSummaryPanel';
import { sprintCsvFilename, sprintIssuesCsv } from './exportCsv';
import { completionPct, fmtPoints } from './sprintSummary';

/** Tab "Sprint": chọn sprint (mặc định đang chạy), thẻ tóm tắt, Burndown và Velocity của sprint đó. */
export function SprintTab({ projectId, projectKey }: { projectId: string; projectKey: string }) {
  const [params, setParams] = useSearchParams();
  const sprintsQ = useProjectSprints(projectId);
  const sprint = sprintsQ.data ? resolveSprint(sprintsQ.data, params.get('sprint')) : undefined;

  const summary = useSprintSummary(sprint?.id, projectId);
  const burndown = useBurndown(sprint?.id, projectId);
  const velocity = useVelocity(projectId);

  function pickSprint(id: string) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('tab', 'sprint');
        p.set('sprint', id);
        return p;
      },
      { replace: true },
    );
  }

  if (sprintsQ.isError) {
    return <QueryError error={sprintsQ.error} onRetry={() => void sprintsQ.refetch()} />;
  }
  if (sprintsQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-[76px] w-full" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
      </div>
    );
  }
  if (!sprint || !sprintsQ.data) {
    return (
      <EmptyState
        title="Chưa có sprint nào"
        description="Tạo sprint ở trang Việc chờ và bắt đầu nó để xem Burndown, Velocity và tóm tắt tại đây."
      />
    );
  }

  const closed = sprint.state === 'CLOSED';
  const options: SearchSelectOption[] = orderSprints(sprintsQ.data).map((s) => ({
    value: s.id,
    label: s.name,
    hint: SPRINT_STATE_LABEL[s.state],
  }));
  const time = sprintTimeInfo(sprint);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SearchSelect
          value={sprint.id}
          onChange={pickSprint}
          options={options}
          ariaLabel="Chọn sprint"
          searchPlaceholder="Tìm sprint…"
          className="w-64 max-w-full"
        />
        <p className="order-last w-full min-w-0 text-sm text-muted sm:order-none sm:w-auto sm:flex-1">
          <span>{SPRINT_STATE_LABEL[sprint.state]}</span>
          {time.range && <span> · {time.range}</span>}
          {sprint.goal && <span className="truncate"> · Mục tiêu: {sprint.goal}</span>}
        </p>
        <SprintExport projectId={projectId} projectKey={projectKey} sprint={sprint} />
      </div>

      {closed && summary.data && (
        <SprintSummaryPanel summary={summary.data} projectKey={projectKey} />
      )}

      {summary.isLoading ? (
        <Skeleton className="h-[92px] w-full" />
      ) : summary.isError ? (
        <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
      ) : summary.data ? (
        <SprintSummaryCards summary={summary.data} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Burndown" caption="Điểm còn lại theo ngày so với đường lý tưởng">
          {burndown.isLoading ? (
            <ChartSkeleton />
          ) : burndown.isError ? (
            <QueryError error={burndown.error} onRetry={() => void burndown.refetch()} />
          ) : !burndown.data || burndown.data.series.length === 0 ? (
            <EmptyState
              title="Chưa có dữ liệu burndown"
              description={
                sprint.state === 'FUTURE'
                  ? 'Sprint chưa bắt đầu. Biểu đồ hiện khi sprint chạy và có ngày kết thúc.'
                  : 'Sprint chưa có ngày bắt đầu hoặc kết thúc nên chưa vẽ được đường lý tưởng.'
              }
            />
          ) : (
            <>
              <p className="mb-2 text-xs text-faint">
                Tính theo điểm của sprint này (cam kết {fmtPoints(burndown.data.committedPoints)}{' '}
                điểm), không phải số việc.
              </p>
              <BurndownChart report={burndown.data} closed={closed} />
            </>
          )}
        </Card>

        <Card
          title="Velocity"
          caption={
            velocity.data
              ? `Trung bình hoàn thành: ${fmtPoints(velocity.data.averageCompleted)} điểm`
              : undefined
          }
        >
          {velocity.isLoading ? (
            <ChartSkeleton />
          ) : velocity.isError ? (
            <QueryError error={velocity.error} onRetry={() => void velocity.refetch()} />
          ) : !velocity.data || velocity.data.sprints.length === 0 ? (
            <EmptyState
              title="Chưa có dữ liệu"
              description="Velocity hiện sau khi có sprint đầu tiên kết thúc."
            />
          ) : (
            <VelocityChart report={velocity.data} highlightSprintId={sprint.id} />
          )}
        </Card>
      </div>
    </div>
  );
}

/** Xuất việc của sprint đang chọn ra CSV, dựa trên danh sách việc dự án (dùng lại cache nếu đã có). */
function SprintExport({
  projectId,
  projectKey,
  sprint,
}: {
  projectId: string;
  projectKey: string;
  sprint: SprintDto;
}) {
  const qc = useQueryClient();
  return (
    <ExportMenu
      items={[
        {
          id: 'csv',
          label: 'Việc trong sprint (CSV)',
          hint: 'Mở được bằng Excel',
          run: async () => {
            const all = await qc.ensureQueryData({
              queryKey: keys.issues.byProject(projectId),
              queryFn: () => fetchAllProjectIssues(qc, projectId),
            });
            const rows = all.filter((i) => i.sprintId === sprint.id);
            if (rows.length === 0) {
              toast.info('Sprint này chưa có việc nào để xuất.');
              return;
            }
            downloadText(sprintCsvFilename(projectKey, sprint.name), sprintIssuesCsv(rows));
            toast.success(`Đã xuất ${rows.length} việc.`);
          },
        },
      ]}
    />
  );
}

/** "đang chạy" → "Đang chạy" cho giá trị ô chỉ số. */
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Hàng 5 chỉ số: Cam kết · Hoàn thành · Còn lại · Thời gian · Velocity TB. */
function SprintSummaryCards({ summary }: { summary: SprintSummaryReport }) {
  const { committed, completed, remaining, initialCommitted, velocity, sprint } = summary;
  const time = sprintTimeInfo(sprint);
  const scopeChanged =
    !!initialCommitted &&
    (initialCommitted.points !== committed.points || initialCommitted.count !== committed.count);

  const timeValue = sprint.state === 'CLOSED' ? 'Đã kết thúc' : upper(time.label);
  const timeSub =
    sprint.state === 'CLOSED'
      ? fmtDate(sprint.completeDate ?? sprint.endDate)
      : (time.range ?? undefined);

  const items: StatItem[] = [
    {
      label: 'Cam kết',
      value: `${fmtPoints(committed.points)} điểm`,
      sub: scopeChanged
        ? `${committed.count} việc · lúc bắt đầu ${fmtPoints(initialCommitted.points)} điểm`
        : `${committed.count} việc`,
    },
    {
      label: 'Hoàn thành',
      value: `${fmtPoints(completed.points)} điểm`,
      sub: `${completed.count} việc · ${completionPct(completed.points, committed.points)}%`,
      tone: 'done',
    },
    {
      label: 'Còn lại',
      value: `${fmtPoints(remaining.points)} điểm`,
      sub: `${remaining.count} việc`,
      tone: remaining.count > 0 ? 'progress' : 'default',
    },
    {
      label: 'Thời gian',
      value: timeValue,
      sub: timeSub,
      tone: sprint.state === 'CLOSED' ? 'default' : time.tone === 'muted' ? 'default' : time.tone,
    },
    {
      label: 'Velocity TB',
      value: velocity.sprintsCounted > 0 ? `${fmtPoints(velocity.average)} điểm` : '—',
      sub:
        velocity.sprintsCounted > 0
          ? `${velocity.sprintsCounted} sprint đã đóng trước đó`
          : 'Chưa có sprint đã đóng để so',
    },
  ];
  return (
    <StatStrip
      items={items}
      className="lg:grid-cols-5 max-lg:[&>:last-child:nth-child(odd)]:col-span-2"
    />
  );
}
