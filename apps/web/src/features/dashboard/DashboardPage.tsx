import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, ChevronRight, Flame, FolderKanban, History, Inbox, Info, TrendingUp } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { IssueDto, StatusCategory } from '@tirapro/types';
import { useProjects } from '../projects/api';
import {
  useMyIssues, useWorkspaceOverview,
  type OverviewAttention, type OverviewForecast, type OverviewProject, type OverviewSlice,
  type OverviewTotals, type OverviewTrendPoint, type OverviewWarning,
} from './api';
import { useAuth } from '@/stores/auth';
import { DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { DueBadge, dueState } from '@/components/ui/DueBadge';
import { pageContainer } from '@/components/layout/page';
import { useRecents } from '@/stores/recentIssues';
import { cn } from '@/lib/utils';

const CATEGORY_COLOR: Record<StatusCategory, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** Ngưỡng rank được coi là "ưu tiên cao" (Highest=5, High=4). */
const HIGH_PRIORITY_RANK = 4;
/** Số issue tối đa hiển thị trong mỗi mục nổi bật ở chế độ cá nhân. */
const SECTION_LIMIT = 6;

function formatToday(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} thg ${d.getMonth() + 1} ${d.getFullYear()}`;
}

function greetingPrefix(d: Date): string {
  const h = d.getHours();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

/**
 * "Bây giờ" luôn cập nhật để lời chào/ngày không bị đóng băng qua trưa/qua ngày:
 * làm mới khi cửa sổ được focus lại và theo nhịp 60s.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const isAdmin = can('workspace:admin') || user?.isSystemAdmin === true;

  const now = useNow();

  return (
    <div className={pageContainer('xl', 'py-6')}>
      {/* Greeting — chung cho cả hai chế độ */}
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">
          {greetingPrefix(now)}
          {user?.displayName ? `, ${user.displayName}` : ''}
        </h1>
        <p className="mt-1 text-sm text-muted">{formatToday(now)}</p>
      </header>

      <RecentsStrip />

      {isAdmin ? <AdminOverview /> : <PersonalOverview />}
    </div>
  );
}

/** Dải "Xem gần đây" — điều hướng nhanh tới issue vừa mở (localStorage). */
function RecentsStrip() {
  const recents = useRecents((s) => s.items);
  if (recents.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-faint">
        <History className="h-3.5 w-3.5" aria-hidden /> Xem gần đây
      </div>
      <div className="flex flex-wrap gap-2">
        {recents.map((r) => (
          <Link
            key={r.key}
            to={`/issue/${r.key}`}
            title={r.summary}
            className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-ink transition-colors hover:border-primary hover:bg-primary-subtle"
          >
            <span className="shrink-0 font-mono text-xs text-muted">{r.key}</span>
            <span className="truncate">{r.summary}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Chế độ ADMIN — tổng quan toàn workspace, mọi dự án                  */
/* ------------------------------------------------------------------ */

function AdminOverview() {
  const { data, isLoading, isError } = useWorkspaceOverview(true);

  return (
    <section className="mb-12">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold text-ink-strong">Tổng quan workspace</h2>
        {data && (
          <span className="text-xs text-faint tabular">{data.projectCount} dự án</span>
        )}
      </div>

      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-surface px-4 py-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-2 h-6 w-10" />
              </div>
            ))}
          </div>
          <Skeleton className="h-40 w-full" />
          <DelayedSpinner />
        </div>
      )}

      {isError && <p className="text-sm text-danger">Không tải được số liệu tổng quan.</p>}

      {data && data.projectCount === 0 && (
        <EmptyState
          icon={<FolderKanban className="h-8 w-8" />}
          title="Chưa có dự án nào để tổng hợp"
          description="Tạo dự án đầu tiên để bắt đầu theo dõi tiến độ toàn workspace."
        />
      )}

      {data && data.projectCount > 0 && (
        <div className="space-y-3">
          {/* Cảnh báo — đặt trên cùng để đập vào mắt trước các số liệu */}
          <WarningCards warnings={data.warnings} />

          <StatRow
            stats={[
              { label: 'Tổng issue', value: data.totals.total },
              { label: 'Bug', value: data.totals.bug, tone: 'bug' },
              { label: 'Đang làm', value: data.totals.inProgress, tone: 'progress' },
              { label: 'Hoàn thành', value: data.totals.done, tone: 'done' },
              { label: 'Quá hạn', value: data.totals.overdue, tone: 'danger' },
            ]}
          />

          {/* Sơ đồ + xu hướng — nhồi 4 khối/hàng cho dày */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ChartCard title="Phân bố trạng thái">
              <StatusDonut totals={data.totals} />
            </ChartCard>
            <ChartCard title="Issue theo loại">
              <SliceBar slices={data.byType} />
            </ChartCard>
            <ChartCard title="Issue theo độ ưu tiên">
              <SliceBar slices={data.byPriority} />
            </ChartCard>
            <ChartCard title="Tạo mới vs Đã xử lý (8 tuần)">
              <TrendChart trend={data.trend} />
            </ChartCard>
          </div>

          {/* Bảng dự án — đặt trên phần dự báo & cần chú ý */}
          <ProjectStatsTable projects={data.projects} />

          {/* Dự báo (bằng chữ) + Task cần chú ý */}
          <div className="grid gap-3 lg:grid-cols-3">
            <ForecastCard forecast={data.forecast} />
            <div className="lg:col-span-2">
              <AttentionCard items={data.attention} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Cảnh báo · Dự báo · Task cần chú ý                                  */
/* ------------------------------------------------------------------ */

const WARN_STYLE: Record<OverviewWarning['level'], { box: string; icon: ReactNode }> = {
  danger: { box: 'border-danger/30 bg-danger/5 text-danger', icon: <AlertTriangle className="h-4 w-4" /> },
  warning: { box: 'border-warning/30 bg-warning/5 text-warning', icon: <AlertTriangle className="h-4 w-4" /> },
  info: { box: 'border-border bg-surface text-muted', icon: <Info className="h-4 w-4" /> },
};

function WarningCards({ warnings }: { warnings: OverviewWarning[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {warnings.map((w, i) => {
        const s = WARN_STYLE[w.level];
        return (
          <div key={i} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', s.box)}>
            <span className="mt-0.5 shrink-0">{s.icon}</span>
            <span className={w.level === 'info' ? 'text-ink' : ''}>{w.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function ForecastCard({ forecast }: { forecast: OverviewForecast[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-strong">
        <TrendingUp className="h-4 w-4 text-primary" /> Dự báo
      </h3>
      <ul className="space-y-2.5">
        {forecast.map((f, i) => (
          <li key={i}>
            <p className="text-xs font-medium uppercase tracking-wide text-faint">{f.label}</p>
            <p className="mt-0.5 text-sm text-ink">{f.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttentionCard({ items }: { items: OverviewAttention[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-strong">
        <Flame className="h-4 w-4 text-danger" /> Cần chú ý
      </h3>
      {items.length === 0 ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">Không có việc nào cần chú ý gấp 👍</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {items.map((it) => (
            <li key={it.key}>
              <Link to={`/issue/${it.key}`} className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-2">
                <span className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', it.level === 'danger' ? 'bg-danger' : 'bg-warning')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-xs text-muted">{it.key}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{it.summary}</span>
                  </span>
                  <span className={cn('text-xs', it.level === 'danger' ? 'text-danger' : 'text-warning')}>{it.reason}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrendChart({ trend }: { trend: OverviewTrendPoint[] }) {
  if (!trend || trend.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} stroke="var(--border)" tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} stroke="var(--border)" width={32} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="created" name="Tạo mới" stroke="var(--status-progress)" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="resolved" name="Đã xử lý" stroke="var(--status-done)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Sơ đồ (recharts)                                                    */
/* ------------------------------------------------------------------ */

const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--ink)',
} as const;

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <h3 className="mb-2 text-xs font-medium text-muted">{title}</h3>
      <div className="h-48">{children}</div>
    </div>
  );
}

function EmptyChart() {
  return <div className="grid h-full place-items-center text-xs text-faint">Chưa có dữ liệu</div>;
}

function StatusDonut({ totals }: { totals: OverviewTotals }) {
  if (totals.total === 0) return <EmptyChart />;
  const data = [
    { name: 'Cần làm', value: totals.todo, color: 'var(--status-todo)' },
    { name: 'Đang làm', value: totals.inProgress, color: 'var(--status-progress)' },
    { name: 'Hoàn thành', value: totals.done, color: 'var(--status-done)' },
  ].filter((d) => d.value > 0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="none">
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend verticalAlign="bottom" height={24} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function SliceBar({ slices }: { slices: OverviewSlice[] }) {
  if (!slices || slices.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={slices} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} stroke="var(--border)" interval={0} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} stroke="var(--border)" width={32} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {slices.map((s) => <Cell key={s.name} fill={s.color ?? 'var(--primary)'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

type StatTone = 'default' | 'progress' | 'done' | 'danger' | 'bug';

const STAT_VALUE_TONE: Record<StatTone, string> = {
  default: 'text-ink-strong',
  progress: 'text-status-progress',
  done: 'text-status-done',
  danger: 'text-danger',
  bug: 'text-danger', // đỏ như "Quá hạn" nhưng KHÔNG có nền cảnh báo (không cùng vị trí nên không rối)
};

/** Số cột trên sm+ khớp đúng số ô → không để lại ô trống viền. */
const SM_COLS: Record<number, string> = {
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
};

function StatRow({
  stats,
}: {
  stats: { label: string; value: number; tone?: StatTone }[];
}) {
  const oddCount = stats.length % 2 === 1; // mobile 2 cột → ô cuối lẻ cần span 2 cho kín
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border',
        SM_COLS[stats.length] ?? 'sm:grid-cols-4',
      )}
    >
      {stats.map((s, idx) => {
        const tone = s.tone ?? 'default';
        const highlight = tone === 'danger' && s.value > 0;
        const fillTail = oddCount && idx === stats.length - 1;
        return (
          <div
            key={s.label}
            className={cn(
              'px-4 py-2.5',
              highlight ? 'bg-danger/5' : 'bg-surface',
              fillTail && 'max-sm:col-span-2',
            )}
          >
            <p className="text-xs font-medium text-muted">{s.label}</p>
            <p className={cn('mt-0.5 text-2xl font-semibold tabular', STAT_VALUE_TONE[tone])}>
              {s.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Nhãn + màu cho thời hạn sprint đang chạy. */
function sprintDue(daysLeft: number | null): { text: string; className: string } {
  if (daysLeft === null) return { text: 'không đặt hạn', className: 'text-faint' };
  if (daysLeft < 0) return { text: `trễ ${-daysLeft} ngày`, className: 'text-danger' };
  if (daysLeft === 0) return { text: 'hết hôm nay', className: 'text-warning' };
  if (daysLeft <= 2) return { text: `còn ${daysLeft} ngày`, className: 'text-warning' };
  return { text: `còn ${daysLeft} ngày`, className: 'text-muted' };
}

function ProjectStatsTable({ projects }: { projects: OverviewProject[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {/* Header cột — ẩn ở mobile để dồn không gian cho số liệu */}
      <div className="hidden items-center gap-3 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-faint sm:flex">
        <span className="min-w-0 flex-1">Dự án</span>
        <span className="hidden w-40 md:block">Sprint đang chạy</span>
        <span className="w-14 text-right tabular">Tổng</span>
        <span className="w-16 text-right tabular">Đang làm</span>
        <span className="w-16 text-right tabular">Xong</span>
        <span className="w-16 text-right tabular">Quá hạn</span>
        <span className="w-24 text-right">Tiến độ</span>
      </div>

      <ul className="divide-y divide-border">
        {projects.map((p) => (
          <ProjectStatsRow key={p.id} project={p} />
        ))}
      </ul>
    </div>
  );
}

function ProjectStatsRow({ project: p }: { project: OverviewProject }) {
  const ratio = p.total > 0 ? p.done / p.total : 0;
  const pct = Math.round(ratio * 100);
  const due = p.sprint ? sprintDue(p.sprint.daysLeft) : null;

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-2">
        <Link
          to={`/p/${p.key}/board`}
          className="group flex min-w-0 flex-1 items-center gap-2.5"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-primary-subtle font-mono text-[11px] font-bold text-primary">
            {p.key.slice(0, 3)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink-strong group-hover:text-primary">
              {p.name}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted">{p.key}</span>
          </span>
        </Link>

        {/* Sprint đang chạy (ẩn dưới md để dồn chỗ cho số liệu) */}
        <span className="hidden w-40 shrink-0 md:block">
          {p.sprint && due ? (
            <>
              <span className="block truncate text-sm text-ink" title={p.sprint.name}>{p.sprint.name}</span>
              <span className={cn('block text-[11px] tabular', due.className)}>{due.text}</span>
            </>
          ) : (
            <span className="text-sm text-faint">Chưa có sprint</span>
          )}
        </span>

        <span className="w-14 text-right text-sm tabular text-ink-strong">{p.total}</span>
        <span className="w-16 text-right text-sm tabular text-status-progress">{p.inProgress}</span>
        <span className="w-16 text-right text-sm tabular text-status-done">{p.done}</span>
        <span
          className={cn(
            'w-16 text-right text-sm tabular',
            p.overdue > 0 ? 'font-semibold text-danger' : 'text-faint',
          )}
        >
          {p.overdue}
        </span>

        <span className="flex w-24 items-center justify-end gap-2">
          <span
            className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Hoàn thành ${pct}%`}
          >
            <span
              className="block h-full rounded-full bg-status-done"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="w-8 text-right text-xs tabular text-muted">{pct}%</span>
        </span>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Chế độ NGƯỜI DÙNG THƯỜNG — cá nhân, xoay quanh "việc của tôi"       */
/* ------------------------------------------------------------------ */

function PersonalOverview() {
  const { data: issues, isLoading, isError } = useMyIssues();
  const { data: projects } = useProjects();

  const keyById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects ?? []) m.set(p.id, p.key);
    return m;
  }, [projects]);

  const { counts, highPriority, dueSoon } = useMemo(() => {
    const list = issues ?? [];
    const notDone = list.filter((i) => i.status.category !== 'DONE');

    const inProgress = list.filter((i) => i.status.category === 'IN_PROGRESS').length;
    const overdue = notDone.filter((i) => dueState(i) === 'overdue').length;

    const highPriority = notDone
      .filter((i) => (i.priority?.rank ?? 0) >= HIGH_PRIORITY_RANK)
      .sort((a, b) => (b.priority?.rank ?? 0) - (a.priority?.rank ?? 0))
      .slice(0, SECTION_LIMIT);

    const dueSoon = notDone
      .filter((i) => {
        const st = dueState(i);
        return st === 'overdue' || st === 'soon';
      })
      .sort((a, b) => {
        // Hạn gần/quá hạn nhất lên trước; issue ở nhánh này luôn có dueDate.
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return da - db;
      })
      .slice(0, SECTION_LIMIT);

    return {
      counts: { total: list.length, inProgress, overdue },
      highPriority,
      dueSoon,
    };
  }, [issues]);

  return (
    <>
      {/* Số liệu cá nhân nhanh */}
      {issues && issues.length > 0 && (
        <div className="mb-8">
          <StatRow
            stats={[
              { label: 'Việc của tôi', value: counts.total },
              { label: 'Đang làm', value: counts.inProgress, tone: 'progress' },
              { label: 'Quá hạn', value: counts.overdue, tone: 'danger' },
            ]}
          />
        </div>
      )}

      {/* Ưu tiên cao */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <Flame className="h-4 w-4 text-danger" aria-hidden />
          <h2 className="text-base font-semibold text-ink-strong">Ưu tiên cao</h2>
        </div>

        {isLoading && <IssueListSkeleton />}
        {isError && <p className="text-sm text-danger">Không tải được danh sách việc của bạn.</p>}
        {issues && highPriority.length === 0 && !isLoading && (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
            Không có việc ưu tiên cao nào đang chờ.
          </p>
        )}
        {highPriority.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {highPriority.map((issue) => (
              <MyIssueRow key={issue.id} issue={issue} projectKey={keyById.get(issue.projectId)} />
            ))}
          </ul>
        )}
      </section>

      {/* Sắp/đã trễ hạn */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-warning" aria-hidden />
          <h2 className="text-base font-semibold text-ink-strong">Sắp/đã trễ hạn</h2>
        </div>

        {isLoading && <IssueListSkeleton />}
        {issues && dueSoon.length === 0 && !isLoading && (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
            Không có việc nào sắp đến hạn.
          </p>
        )}
        {dueSoon.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {dueSoon.map((issue) => (
              <MyIssueRow key={issue.id} issue={issue} projectKey={keyById.get(issue.projectId)} showDue />
            ))}
          </ul>
        )}
      </section>

      {/* Việc của tôi (danh sách đầy đủ, mới cập nhật trước) */}
      <section className="mb-12">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold text-ink-strong">Việc của tôi</h2>
          {issues && issues.length > 0 && (
            <span className="text-xs text-faint tabular">{issues.length} việc gần đây</span>
          )}
        </div>

        {isLoading && <IssueListSkeleton />}
        {isError && <p className="text-sm text-danger">Không tải được danh sách việc của bạn.</p>}
        {issues && issues.length === 0 && (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="Bạn chưa được giao việc nào"
            description="Khi có việc được giao cho bạn, chúng sẽ xuất hiện ở đây."
          />
        )}
        {issues && issues.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {issues.map((issue) => (
              <MyIssueRow key={issue.id} issue={issue} projectKey={keyById.get(issue.projectId)} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function IssueListSkeleton() {
  return (
    <div className="space-y-px overflow-hidden rounded-lg border border-border bg-surface">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
      <DelayedSpinner />
    </div>
  );
}

function MyIssueRow({
  issue,
  projectKey,
  showDue,
}: {
  issue: IssueDto;
  projectKey: string | undefined;
  /** Hiện nhãn hạn chót (cho mục "Sắp/đã trễ hạn"). */
  showDue?: boolean;
}) {
  const dot = CATEGORY_COLOR[issue.status.category];
  const to = `/issue/${issue.key}`;

  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: dot }}
          title={issue.status.name}
          aria-hidden
        />
        <span className="shrink-0 font-mono text-xs font-medium text-muted">{issue.key}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-strong">{issue.summary}</span>
        {showDue && <DueBadge issue={issue} warnOnly className="shrink-0" />}
        {issue.priority && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: issue.priority.color ?? 'var(--status-todo)' }}
            title={issue.priority.name}
            aria-hidden
          />
        )}
        {projectKey && (
          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted">
            {projectKey}
          </span>
        )}
      </Link>
    </li>
  );
}

