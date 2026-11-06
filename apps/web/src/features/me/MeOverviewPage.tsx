import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ListChecks } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCalendarDmy } from '@tirapro/shared';
import type { MeIssueItemDto, MeOverviewDto } from '@tirapro/types';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatRow, type StatItem } from '@/components/ui/StatRow';
import { StatusPill } from '@/components/ui/StatusPill';
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { usePriorityRanks } from '@/features/issue-meta/usePriorityRanks';
import { AXIS_PROPS, LEGEND_STYLE, TOOLTIP_STYLE } from '@/features/reports/charts';
import { CHART_MARGIN, yAxisWidth } from '@/lib/chartAxis';
import { filtersHref } from '@/features/assistant/queries';
import { APP_NAV_LABELS } from '@/lib/navLabels';
import { CHIP_ROW_GAP_COARSE, CHIP_TOUCH_HIT } from '@/lib/touchHit';
import { cn } from '@/lib/utils';
import { useMeOverview } from './api';
import {
  buildChart,
  chartSummary,
  defaultBugTab,
  filterByProject,
  MY_OPEN_JQL,
  projectChips,
  rowDue,
  type BugTab,
} from './meView';

/** Trang "Của tôi": việc được giao, bug liên quan và điểm đã xong của người đang đăng nhập, trong các dự án họ xem được. */
export function MeOverviewPage() {
  const query = useMeOverview();
  return (
    <PageFrame size="xl" className="py-6">
      <PageHeader
        data-tour="me-header"
        title={APP_NAV_LABELS.me}
        description="Việc được giao, bug liên quan đến bạn và điểm đã xong — trong các dự án bạn xem được."
      />
      <QueryBoundary query={query} skeleton={<PageSkeleton />}>
        {(data) => <Overview data={data} />}
      </QueryBoundary>
    </PageFrame>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function statItems(c: MeOverviewDto['counts']): StatItem[] {
  return [
    { label: 'Việc chưa xong', value: c.open, title: 'Việc giao cho bạn chưa ở trạng thái Xong' },
    {
      label: 'Quá hạn',
      value: c.overdue,
      tone: c.overdue > 0 ? 'danger' : 'default',
      highlight: c.overdue > 0,
      title: 'Việc chưa xong có hạn trước hôm nay',
    },
    {
      label: 'Đến hạn trong 7 ngày',
      value: c.dueSoon,
      tone: c.dueSoon > 0 ? 'warning' : 'default',
      title: 'Việc chưa xong có hạn từ hôm nay đến 6 ngày tới (không gồm quá hạn)',
    },
    {
      label: 'Điểm xong tuần này',
      value: c.donePointsThisWeek,
      sub: 'từ Thứ Hai',
      tone: 'done',
      title: 'Điểm các việc lá bạn đã làm xong từ Thứ Hai (giờ Việt Nam)',
    },
  ];
}

function Overview({ data }: { data: MeOverviewDto }) {
  return (
    <div className="space-y-8">
      <StatRow items={statItems(data.counts)} data-tour="me-stats" />
      <MyIssuesSection items={data.myIssues} open={data.counts.open} />
      <BugsSection bugs={data.bugs} />
      <WeeklyChart weeks={data.weeklyDonePoints} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Việc của tôi                                                        */
/* ------------------------------------------------------------------ */

function MyIssuesSection({ items, open }: { items: MeIssueItemDto[]; open: number }) {
  const [project, setProject] = useState<string | null>(null);
  const chips = useMemo(() => projectChips(items), [items]);
  // Chip dự án biến mất sau khi tải lại dữ liệu → quay về "Tất cả" thay vì hiện danh sách rỗng.
  const active = project && chips.some((c) => c.key === project) ? project : null;
  const rows = useMemo(() => filterByProject(items, active), [items, active]);

  return (
    <section aria-labelledby="me-issues-h" data-tour="me-issues">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 id="me-issues-h" className="text-base font-semibold text-ink-strong">
          Việc của tôi
        </h2>
        <span className="tabular text-xs text-muted">
          {open} việc
          {open > items.length ? ` · hiện ${items.length} việc đầu, xếp theo hạn` : ''}
        </span>
        <Link
          to={filtersHref(MY_OPEN_JQL)}
          className="ml-auto text-xs font-medium text-primary hover:underline"
        >
          Xem tất cả
        </Link>
      </div>
      {items.length === 0 ? (
        <EmptyState
          size="compact"
          icon={<CheckCircle2 />}
          title="Bạn không có việc nào đang chờ"
          description="Việc được giao cho bạn và chưa xong sẽ hiện ở đây, xếp theo hạn rồi mức ưu tiên."
          action={
            <Link to="/projects" className="text-sm font-medium text-primary hover:underline">
              Xem các dự án
            </Link>
          }
        />
      ) : (
        <>
          {chips.length > 1 && (
            <div
              role="group"
              aria-label={`Lọc theo dự án (trong ${items.length} việc đang hiện)`}
              className={cn(
                'mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-2',
                CHIP_ROW_GAP_COARSE,
              )}
            >
              <ProjectChip
                label="Tất cả"
                count={items.length}
                on={active === null}
                onClick={() => setProject(null)}
              />
              {chips.map((c) => (
                <ProjectChip
                  key={c.key}
                  label={c.key}
                  count={c.count}
                  mono
                  on={active === c.key}
                  onClick={() => setProject(active === c.key ? null : c.key)}
                />
              ))}
            </div>
          )}
          <IssueList items={rows} />
        </>
      )}
    </section>
  );
}

function ProjectChip({
  label,
  count,
  on,
  mono,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  mono?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={on ? 'Bấm để bỏ lọc' : `Chỉ hiện việc của dự án ${label}`}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium transition-colors',
        CHIP_TOUCH_HIT,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        on
          ? 'border-transparent bg-primary-subtle text-primary'
          : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      <span className={cn(mono && 'font-mono')}>{label}</span>
      <span className="tabular">{count}</span>
    </button>
  );
}

function IssueList({ items }: { items: MeIssueItemDto[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {items.map((i) => (
        <IssueRow key={i.id} item={i} />
      ))}
    </ul>
  );
}

function IssueRow({ item }: { item: MeIssueItemDto }) {
  const ranks = usePriorityRanks();
  const state = rowDue(item);
  const overdue = state === 'overdue';
  return (
    <li>
      <Link
        to={`/issue/${item.key}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-surface-2 sm:flex-nowrap"
      >
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted">
          {item.projectKey}
        </span>
        <span className="shrink-0 font-mono text-xs font-medium text-muted">{item.key}</span>
        <span className="min-w-0 basis-full truncate text-sm text-ink-strong sm:basis-0 sm:flex-1">
          {item.summary}
        </span>
        <StatusPill status={item.status} alwaysShowName />
        {item.priority && (
          <PriorityIcon
            name={item.priority.name}
            rank={item.priority.rank}
            ranks={ranks}
            color={null}
          />
        )}
        <span className="tabular w-14 shrink-0 text-right text-xs text-muted">
          {item.points !== null ? `${item.points} điểm` : ''}
        </span>
        <span
          className={cn(
            'tabular inline-flex w-24 shrink-0 items-center justify-end gap-1 text-xs',
            overdue
              ? 'font-medium text-danger'
              : state === 'soon'
                ? 'text-warning-ink'
                : 'text-muted',
          )}
          title={overdue ? 'Quá hạn' : state === 'soon' ? 'Đến hạn trong 7 ngày tới' : undefined}
        >
          {overdue && <AlertTriangle className="h-3 w-3" aria-hidden />}
          {item.dueDate ? (
            <>
              {overdue && <span className="sr-only">Quá hạn, </span>}
              {formatCalendarDmy(item.dueDate)}
            </>
          ) : (
            <span>Chưa có hạn</span>
          )}
        </span>
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Bug liên quan đến tôi                                               */
/* ------------------------------------------------------------------ */

const BUG_EMPTY: Record<BugTab, { title: string; description: string }> = {
  awaitingRetest: {
    title: 'Không có bug nào chờ bạn test lại',
    description: 'Bug bạn báo và đang chờ test lại sẽ hiện ở đây.',
  },
  reopened: {
    title: 'Không có bug nào được mở lại',
    description: 'Bug bạn báo mà bị mở lại sẽ hiện ở đây.',
  },
  assignedToMe: {
    title: 'Không có bug nào giao cho bạn',
    description: 'Bug chưa xong được giao cho bạn sẽ hiện ở đây.',
  },
};

/** Số việc nằm ngoài tên truy cập của tab (aria-hidden): trình đọc màn hình nghe "Mở lại", số hiện qua danh sách bên dưới. */
function tabLabel(name: string, count: number) {
  return (
    <>
      {name}
      <span aria-hidden className="tabular">
        {' · '}
        {count}
      </span>
    </>
  );
}

function BugsSection({ bugs }: { bugs: MeOverviewDto['bugs'] }) {
  const [tab, setTab] = useState<BugTab>(() => defaultBugTab(bugs));
  const items: TabItem<BugTab>[] = [
    { id: 'awaitingRetest', label: tabLabel('Chờ test lại', bugs.awaitingRetest.length) },
    { id: 'reopened', label: tabLabel('Mở lại', bugs.reopened.length) },
    { id: 'assignedToMe', label: tabLabel('Giao cho tôi', bugs.assignedToMe.length) },
  ];
  const rows = bugs[tab];
  return (
    <section aria-labelledby="me-bugs-h" data-tour="me-bugs">
      <h2 id="me-bugs-h" className="mb-1 text-base font-semibold text-ink-strong">
        Bug liên quan đến tôi
      </h2>
      <Tabs
        idBase="me-bugs"
        ariaLabel="Nhóm bug liên quan đến tôi"
        value={tab}
        onChange={setTab}
        items={items}
        fade
        className="mb-3 overflow-x-auto"
      />
      <TabPanel idBase="me-bugs" value={tab}>
        {rows.length === 0 ? (
          <EmptyState size="compact" icon={<ListChecks />} {...BUG_EMPTY[tab]} />
        ) : (
          <IssueList items={rows} />
        )}
      </TabPanel>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Điểm đã xong theo tuần                                              */
/* ------------------------------------------------------------------ */

function WeeklyChart({ weeks }: { weeks: MeOverviewDto['weeklyDonePoints'] }) {
  const model = useMemo(() => buildChart(weeks), [weeks]);
  return (
    <SectionCard
      data-tour="me-weekly"
      title="Điểm đã xong theo tuần"
      description="8 tuần gần nhất (tuần bắt đầu Thứ Hai), chỉ tính việc lá bạn đã làm xong."
    >
      {model.totalPoints === 0 ? (
        <EmptyState
          size="compact"
          icon={<CheckCircle2 />}
          title="Chưa có điểm hoàn thành trong 8 tuần qua"
          description="Điểm sẽ hiện ở đây khi bạn chuyển việc sang Xong."
        />
      ) : (
        <div role="img" aria-label={chartSummary(model)}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={model.rows} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" {...AXIS_PROPS} />
              <YAxis
                {...AXIS_PROPS}
                allowDecimals={false}
                axisLine={false}
                width={yAxisWidth(model.rows.map((r) => r.total))}
              />
              <Tooltip
                cursor={{ fill: 'var(--surface-2)' }}
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(l) => `Tuần ${String(l)}`}
              />
              <Legend wrapperStyle={LEGEND_STYLE} />
              {model.series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="done"
                  fill={s.color}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}
