import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* ─────────────────────────── Kiểu dữ liệu ─────────────────────────── */

export interface TimesheetEntry {
  id: string;
  date: string;
  timeSpent: number;
  comment: string | null;
}

export interface TimesheetRow {
  issueId: string;
  issueKey: string;
  summary: string;
  projectId: string;
  projectKey: string;
  typeName: string | null;
  typeColor: string | null;
  /** { 'YYYY-MM-DD': số giây } */
  perDay: Record<string, number>;
  total: number;
  entries: TimesheetEntry[];
  /** Dòng gợi ý: việc đang được giao nhưng chưa ghi công trong kỳ. */
  suggested: boolean;
}

export interface TimesheetReport {
  from: string;
  to: string;
  userId: string;
  canViewOthers: boolean;
  days: string[];
  rows: TimesheetRow[];
  totalsByDay: Record<string, number>;
  total: number;
}

export interface TimesheetIssueOption {
  issueId: string;
  issueKey: string;
  summary: string;
  projectId: string;
  projectKey: string;
}

export interface TimesheetParams {
  from: string;
  to: string;
  userId?: string;
  projectId?: string;
}

export interface SetCellInput {
  issueId: string;
  /** YYYY-MM-DD */
  date: string;
  timeSpent: number;
  userId?: string;
  /** Metadata của dòng mới thêm (chỉ dùng phía client để cập nhật lạc quan). */
  issue?: TimesheetIssueOption;
}

export const timesheetKey = (p: TimesheetParams) => ['timesheet', p] as const;

function cleanParams(p: TimesheetParams): TimesheetParams {
  return { from: p.from, to: p.to, userId: p.userId || undefined, projectId: p.projectId || undefined };
}

/* ─────────────────────────── Hooks ─────────────────────────── */

/** Lưới chấm công ISSUE × NGÀY trong khoảng đã chọn. */
export function useTimesheet(params: TimesheetParams) {
  const p = cleanParams(params);
  return useQuery({
    queryKey: timesheetKey(p),
    queryFn: async () => (await api.get<TimesheetReport>('/timesheet', { params: p })).data,
  });
}

/** Danh sách công việc để thêm dòng vào lưới (tìm theo mã hoặc tiêu đề). */
export function useTimesheetIssues(term: string, projectId?: string, enabled = true) {
  const q = term.trim();
  return useQuery({
    queryKey: ['timesheet-issues', q, projectId ?? ''] as const,
    queryFn: async () =>
      (await api.get<TimesheetIssueOption[]>('/timesheet/issues', { params: { q: q || undefined, projectId: projectId || undefined } })).data,
    enabled,
  });
}

/**
 * Đặt tổng giờ của một ô (issue × ngày). Cập nhật lạc quan ngay trên lưới rồi
 * đồng bộ lại với máy chủ (UX §optimistic).
 */
export function useSetTimesheetCell(params: TimesheetParams) {
  const qc = useQueryClient();
  const key = timesheetKey(cleanParams(params));
  return useMutation({
    mutationFn: ({ issue, ...body }: SetCellInput) => api.put('/timesheet/cell', body).then((r) => r.data),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TimesheetReport>(key);
      if (previous) qc.setQueryData<TimesheetReport>(key, patchCell(previous, input));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['timesheet'] });
      void qc.invalidateQueries({ queryKey: ['workload'] });
    },
  });
}

export function useLogTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { issueId: string; startedAt: string; timeSpent: number; comment?: string | null; userId?: string }) =>
      api.post('/timesheet/log', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['timesheet'] });
      void qc.invalidateQueries({ queryKey: ['workload'] });
    },
  });
}

export function useDeleteWorkLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/timesheet/log/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['timesheet'] });
      void qc.invalidateQueries({ queryKey: ['workload'] });
    },
  });
}

/** Ghi đè giá trị một ô trong bản báo cáo đang cache (dùng cho optimistic update). */
function patchCell(report: TimesheetReport, input: SetCellInput): TimesheetReport {
  const { issueId, date, timeSpent, issue } = input;
  let delta = 0;
  let found = false;
  const rows = report.rows.map((row) => {
    if (row.issueId !== issueId) return row;
    found = true;
    const prev = row.perDay[date] ?? 0;
    delta = timeSpent - prev;
    const perDay = { ...row.perDay };
    if (timeSpent > 0) perDay[date] = timeSpent;
    else delete perDay[date];
    return { ...row, perDay, total: row.total + delta, suggested: false };
  });

  // Dòng vừa thêm thủ công chưa có trong báo cáo → chèn ngay để lưới không nhấp nháy.
  if (!found && issue && timeSpent > 0) {
    delta = timeSpent;
    rows.push({
      ...issue,
      typeName: null,
      typeColor: null,
      perDay: { [date]: timeSpent },
      total: timeSpent,
      entries: [],
      suggested: false,
    });
  }

  return {
    ...report,
    rows,
    totalsByDay: { ...report.totalsByDay, [date]: (report.totalsByDay[date] ?? 0) + delta },
    total: report.total + delta,
  };
}

/* ─────────────────────────── Thời lượng ─────────────────────────── */

/**
 * Hiểu nhiều cách gõ: `1h30`, `1h 30m`, `1.5`, `1,5`, `90m`, `1:30`.
 * Trả về số giây, `0` khi rỗng, `null` khi không đọc được.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(',', '.');
  if (!s) return 0;

  let m = /^(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2})\s*m?)?$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 3600 + (m[2] ? Number(m[2]) * 60 : 0));

  m = /^(\d+)\s*m$/.exec(s);
  if (m) return Number(m[1]) * 60;

  m = /^(\d{1,2}):([0-5]?\d)$/.exec(s);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;

  m = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 3600);

  return null;
}

/** Số giây → `1h30`, `2h`, `45m`; 0 → chuỗi rỗng. */
export function formatDuration(seconds: number): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h && m) return `${h}h${String(m).padStart(2, '0')}`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Số giây → giờ thập phân (dùng cho tổng & xuất CSV). */
export function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

/* ─────────────────────────── Ngày ─────────────────────────── */

export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay();
  return addDays(x, dow === 0 ? -6 : 1 - dow);
}

const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** `2026-07-24` → `{ weekday: 'T6', day: '24/07', isWeekend: false }`. */
export function dayMeta(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const dow = d.getDay();
  return {
    weekday: WEEKDAY_LABELS[dow],
    day: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
    isWeekend: dow === 0 || dow === 6,
    isToday: iso === isoDay(new Date()),
  };
}
