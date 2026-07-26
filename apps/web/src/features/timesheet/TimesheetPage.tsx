import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PeoplePicker, type PersonOption } from '@/components/ui/PeoplePicker';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { useWorkspaceUsers } from '@/features/members/api';
import { useProjects } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import {
  addDays,
  dayMeta,
  formatDuration,
  isoDay,
  mondayOf,
  parseDuration,
  toHours,
  useDeleteWorkLog,
  useSetTimesheetCell,
  useTimesheet,
  useTimesheetIssues,
  type TimesheetIssueOption,
  type TimesheetRow,
} from './api';

/** Chấm công theo tuần — lưới CÔNG VIỆC × 7 NGÀY, nhập giờ trực tiếp, không cần duyệt. */
export function TimesheetPage() {
  const myId = useAuth((s) => s.user?.id) ?? '';
  const [weekStart, setWeekStart] = useState(() => isoDay(mondayOf(new Date())));
  const [userId, setUserId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [extraRows, setExtraRows] = useState<TimesheetIssueOption[]>([]);

  const from = weekStart;
  const to = useMemo(() => isoDay(addDays(new Date(`${weekStart}T00:00:00`), 6)), [weekStart]);
  const params = useMemo(
    () => ({ from, to, userId: userId || undefined, projectId: projectId || undefined }),
    [from, to, userId, projectId],
  );

  const ts = useTimesheet(params);
  const setCell = useSetTimesheetCell(params);
  const deleteLog = useDeleteWorkLog();
  const { data: users } = useWorkspaceUsers();
  const { data: projects } = useProjects();

  const canViewOthers = ts.data?.canViewOthers ?? false;
  const targetUserId = ts.data?.userId ?? myId;
  const isSelf = targetUserId === myId;

  const people: PersonOption[] = useMemo(
    () =>
      (users ?? []).map((u) => ({
        id: u.id,
        name: u.displayName,
        avatarUrl: u.avatarUrl,
        email: u.email,
        search: `${u.displayName} ${u.email}`.toLowerCase(),
      })),
    [users],
  );
  const projectOptions = useMemo(
    () => [{ value: '', label: 'Tất cả dự án' }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key }))],
    [projects],
  );

  const days = ts.data?.days ?? [];
  const rows: TimesheetRow[] = useMemo(() => {
    const base = ts.data?.rows ?? [];
    const known = new Set(base.map((r) => r.issueId));
    const extras: TimesheetRow[] = extraRows
      .filter((e) => !known.has(e.issueId))
      .map((e) => ({ ...e, typeName: null, typeColor: null, perDay: {}, total: 0, entries: [], suggested: false }));
    return [...base, ...extras];
  }, [ts.data, extraRows]);

  const totalsByDay = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const d of days) acc[d] = rows.reduce((s, r) => s + (r.perDay[d] ?? 0), 0);
    return acc;
  }, [days, rows]);
  const weekTotal = days.reduce((s, d) => s + (totalsByDay[d] ?? 0), 0);

  const comments = useMemo(
    () => rows.flatMap((r) => r.entries.filter((e) => e.comment).map((e) => ({ ...e, row: r }))),
    [rows],
  );

  function shiftWeek(delta: number) {
    setWeekStart(isoDay(addDays(new Date(`${weekStart}T00:00:00`), delta * 7)));
  }

  function commitCell(row: TimesheetRow, date: string, seconds: number) {
    setCell.mutate(
      {
        issueId: row.issueId,
        date,
        timeSpent: seconds,
        userId: isSelf ? undefined : targetUserId,
        issue: {
          issueId: row.issueId, issueKey: row.issueKey, summary: row.summary,
          projectId: row.projectId, projectKey: row.projectKey,
        },
      },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function handleExport() {
    if (!ts.data) return;
    const who = users?.find((u) => u.id === targetUserId)?.displayName ?? 'toi';
    downloadCsv(buildCsv(rows, days, totalsByDay, weekTotal), `cham-cong_${slug(who)}_${from}_${to}.csv`);
  }

  return (
    <div className={pageContainer('xl')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Chấm công</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Nhập giờ thẳng vào lưới — gõ <span className="font-mono text-ink">1h30</span>,{' '}
          <span className="font-mono text-ink">1.5</span>, <span className="font-mono text-ink">90m</span> hay{' '}
          <span className="font-mono text-ink">1:30</span> đều hiểu. Lưu ngay, không cần duyệt.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border">
          <Button variant="ghost" size="icon" aria-label="Tuần trước" onClick={() => shiftWeek(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium tabular-nums text-ink">
            {dayMeta(from).day} – {dayMeta(to).day}
          </span>
          <Button variant="ghost" size="icon" aria-label="Tuần sau" onClick={() => shiftWeek(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setWeekStart(isoDay(mondayOf(new Date())))}>
          Tuần này
        </Button>

        {canViewOthers && (
          <div className="min-w-[13rem]">
            <PeoplePicker
              value={userId}
              onChange={setUserId}
              options={people}
              emptyLabel="Chấm công của tôi"
              ariaLabel="Chọn người xem chấm công"
            />
          </div>
        )}

        <div className="min-w-[12rem]">
          <SearchSelect
            value={projectId}
            onChange={setProjectId}
            options={projectOptions}
            ariaLabel="Lọc theo dự án"
            searchPlaceholder="Tìm dự án…"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted">
            Tổng tuần <strong className="font-semibold tabular-nums text-ink-strong">{toHours(weekTotal).toString().replace('.', ',')}h</strong>
          </span>
          <Button variant="secondary" size="sm" onClick={handleExport} disabled={!ts.data || rows.length === 0}>
            <Download className="h-4 w-4" aria-hidden /> Xuất CSV
          </Button>
        </div>
      </div>

      {ts.isError ? (
        <QueryError error={ts.error} onRetry={() => void ts.refetch()} />
      ) : ts.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title="Tuần này chưa có công việc nào"
          description="Thêm công việc vào lưới bên dưới rồi nhập giờ, hoặc nhận việc để nó tự xuất hiện ở đây."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Giờ làm việc theo công việc và theo ngày trong tuần</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="sticky left-0 z-[1] min-w-[16rem] bg-surface px-4 py-2.5 text-left text-xs font-medium text-muted">
                  Công việc
                </th>
                {days.map((d) => {
                  const m = dayMeta(d);
                  return (
                    <th
                      key={d}
                      scope="col"
                      className={cn(
                        'min-w-[4.75rem] px-2 py-2 text-center text-xs font-medium',
                        m.isWeekend ? 'text-faint' : 'text-muted',
                        m.isToday && 'text-primary',
                      )}
                    >
                      <span className="block">{m.weekday}</span>
                      <span className="block tabular-nums font-normal">{m.day}</span>
                    </th>
                  );
                })}
                <th scope="col" className="min-w-[5rem] px-3 py-2.5 text-right text-xs font-medium text-muted">Tổng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.issueId} className="border-b border-border last:border-0">
                  <th scope="row" className="sticky left-0 z-[1] max-w-[22rem] bg-surface px-4 py-2 text-left font-normal">
                    <Link
                      to={`/issue/${row.issueKey}`}
                      className="group flex min-w-0 items-baseline gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <span className="shrink-0 font-mono text-xs text-faint">{row.issueKey}</span>
                      <span className="truncate text-sm text-ink group-hover:text-primary">{row.summary}</span>
                    </Link>
                  </th>

                  {days.map((d) => (
                    <td key={d} className={cn('p-1', dayMeta(d).isWeekend && 'bg-surface-2/50')}>
                      <CellInput
                        value={row.perDay[d] ?? 0}
                        ariaLabel={`${row.issueKey} ngày ${d}`}
                        onCommit={(secs) => commitCell(row, d, secs)}
                      />
                    </td>
                  ))}

                  <td className="px-3 py-2 text-right text-sm tabular-nums text-ink">
                    {row.total ? formatDuration(row.total) : <span className="text-faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-surface-2">
                <th scope="row" className="sticky left-0 z-[1] bg-surface-2 px-4 py-2.5 text-left text-xs font-medium text-muted">
                  Tổng theo ngày
                </th>
                {days.map((d) => (
                  <td key={d} className="px-2 py-2.5 text-center text-sm font-medium tabular-nums text-ink-strong">
                    {totalsByDay[d] ? formatDuration(totalsByDay[d]) : <span className="font-normal text-faint">—</span>}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-ink-strong">
                  {weekTotal ? formatDuration(weekTotal) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <AddIssueRow
        projectId={projectId}
        onPick={(issue) => {
          setExtraRows((prev) => (prev.some((p) => p.issueId === issue.issueId) ? prev : [...prev, issue]));
          toast.success(`Đã thêm ${issue.issueKey} vào lưới`);
        }}
      />

      {comments.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-ink-strong">Ghi chú trong tuần</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {comments.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="shrink-0 font-mono text-xs text-faint">{c.row.issueKey}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {dayMeta(c.date).day} · {formatDuration(c.timeSpent)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.comment}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted hover:text-danger"
                  title="Xoá bản ghi công"
                  aria-label={`Xoá bản ghi công ${c.row.issueKey} ngày ${c.date}`}
                  loading={deleteLog.isPending && deleteLog.variables === c.id}
                  onClick={() =>
                    deleteLog.mutate(c.id, {
                      onSuccess: () => toast.success('Đã xoá bản ghi công'),
                      onError: (e) => toast.error(apiErrorMessage(e)),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isSelf && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted">
          <Avatar
            name={users?.find((u) => u.id === targetUserId)?.displayName ?? 'Thành viên'}
            src={users?.find((u) => u.id === targetUserId)?.avatarUrl}
            size={18}
          />
          Bạn đang chấm công hộ người khác — mọi thay đổi ghi vào tài khoản của họ.
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────── Ô nhập giờ ─────────────────────────── */

function CellInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: number;
  onCommit: (seconds: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const shown = draft ?? formatDuration(value);

  function commit() {
    const raw = draft;
    setDraft(null);
    if (raw === null) return;
    const seconds = parseDuration(raw);
    if (seconds === null) {
      toast.error('Không đọc được số giờ. Ví dụ: 1h30, 1.5, 90m, 1:30');
      return;
    }
    if (seconds === value) return;
    onCommit(seconds);
  }

  return (
    <input
      ref={ref}
      value={shown}
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder="—"
      onFocus={() => setDraft(formatDuration(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur(); }
        if (e.key === 'Escape') { setDraft(null); ref.current?.blur(); }
      }}
      className={cn(
        'h-9 w-full rounded-md border border-transparent bg-transparent px-1 text-center text-sm tabular-nums text-ink',
        'placeholder:text-faint hover:border-border',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
      )}
    />
  );
}

/* ─────────────────────── Thêm công việc vào lưới ─────────────────────── */

/** Trì hoãn giá trị để không bắn request theo từng phím gõ. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function AddIssueRow({ projectId, onPick }: { projectId: string; onPick: (issue: TimesheetIssueOption) => void }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(term, 220);
  const { data, isFetching } = useTimesheetIssues(debounced, projectId, open);
  const results = (data ?? []).slice(0, 6);

  return (
    <div className="mt-3">
      <label htmlFor="ts-add" className="sr-only">Thêm công việc vào lưới chấm công</label>
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center text-faint" aria-hidden>
          <Plus className="h-4 w-4" />
        </span>
        <Input
          id="ts-add"
          value={term}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) { e.preventDefault(); onPick(results[0]); setTerm(''); setOpen(false); }
            if (e.key === 'Escape') { setOpen(false); }
          }}
          placeholder="Thêm công việc vào lưới — gõ mã hoặc tiêu đề…"
          className="max-w-md text-sm"
        />
        {isFetching && <span className="text-xs text-faint">Đang tìm…</span>}
      </div>

      {open && results.length > 0 && (
        <ul className="mt-2 max-w-md overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          {results.map((r) => (
            <li key={r.issueId}>
              <button
                type="button"
                onClick={() => { onPick(r); setTerm(''); setOpen(false); }}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2"
              >
                <span className="shrink-0 font-mono text-xs text-faint">{r.issueKey}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────── Xuất CSV ─────────────────────────── */

function csvCell(v: string | number): string {
  const s = String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function hoursText(seconds: number): string {
  return String(toHours(seconds)).replace('.', ',');
}

function buildCsv(
  rows: TimesheetRow[],
  days: string[],
  totalsByDay: Record<string, number>,
  weekTotal: number,
): string {
  const lines: string[][] = [
    ['Dự án', 'Mã', 'Công việc', ...days.map((d) => `${dayMeta(d).weekday} ${dayMeta(d).day}`), 'Tổng (giờ)'],
    ...rows.map((r) => [r.projectKey, r.issueKey, r.summary, ...days.map((d) => hoursText(r.perDay[d] ?? 0)), hoursText(r.total)]),
    ['', '', 'Tổng theo ngày', ...days.map((d) => hoursText(totalsByDay[d] ?? 0)), hoursText(weekTotal)],
  ];
  return `﻿${lines.map((cols) => cols.map(csvCell).join(';')).join('\r\n')}`;
}

function downloadCsv(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nguoi-dung';
}
