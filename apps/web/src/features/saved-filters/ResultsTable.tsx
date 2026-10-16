import { useCallback, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronLeft, ChevronRight, Columns3, Filter as FilterIcon, SearchX } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { dueState } from '@/components/ui/DueBadge';
import { IssueTypeBadge } from '@/components/ui/IssueTypeBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { exportIssuesCsvWithToast } from '@/features/export/api';
import { openOnClick, openOnRowKey } from '@/lib/rowOpen';
import { categoryColor } from '@/lib/statusColor';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import {
  RESULT_COLUMNS,
  cellText,
  loadColumns,
  saveColumns,
  type ResultColumnId,
} from './resultColumns';

const RESULTS_PAGE_SIZE = 25;

/**
 * Cột đang chọn của người dùng (nhớ trong localStorage theo `userId`). `columns` luôn có `key` + `summary`.
 * L2 (Xuất CSV) dùng chính hook này + `cellText`/`RESULT_COLUMNS` để xuất đúng cột đang xem.
 */
export function useResultColumns(): {
  columns: ResultColumnId[];
  toggle: (id: ResultColumnId) => void;
} {
  const userId = useAuth((s) => s.user?.id ?? 'anonymous');
  const [state, setState] = useState(() => ({ userId, columns: loadColumns(userId) }));
  // Đổi người dùng (đăng xuất/đăng nhập tài khoản khác) → nạp lại cột của người đó.
  const current = state.userId === userId ? state : { userId, columns: loadColumns(userId) };
  if (current !== state) setState(current);

  const toggle = useCallback(
    (id: ResultColumnId) => {
      const def = RESULT_COLUMNS.find((c) => c.id === id);
      if (!def || def.locked) return;
      const has = current.columns.includes(id);
      const next = RESULT_COLUMNS.filter((c) =>
        c.id === id ? !has : current.columns.includes(c.id),
      ).map((c) => c.id);
      saveColumns(userId, next);
      setState({ userId, columns: next });
    },
    [current.columns, userId],
  );
  return { columns: current.columns, toggle };
}

export function ResultsTable({
  issues,
  loading,
  hasRun,
  error,
  page,
  onPageChange,
  projectKeyById,
  onOpen,
  exportJql,
}: {
  issues: IssueDto[] | null;
  loading: boolean;
  hasRun: boolean;
  /** Truy vấn lỗi (cú pháp/giá trị): lỗi đã hiện ở ô JQL nên không hiện thêm "Không có công việc nào khớp". */
  error: string | null;
  page: number;
  onPageChange: (p: number) => void;
  projectKeyById: Map<string, string>;
  onOpen: (key: string) => void;
  /** JQL của kết quả đang xem; có thì hiện nút Xuất CSV (tải ĐỦ mọi dòng ở máy chủ, theo cột đang chọn). */
  exportJql?: string;
}) {
  const { columns, toggle } = useResultColumns();
  const wide = useMediaQuery('(min-width: 640px)', true);
  const ctx = useMemo(() => ({ projectKeyById }), [projectKeyById]);

  if (loading && !issues) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (!hasRun) {
    return (
      <EmptyState
        icon={<FilterIcon className="h-8 w-8" aria-hidden />}
        title="Chọn hoặc chạy một bộ lọc"
        description="Chọn một bộ lọc đã lưu ở cột trái, hoặc chạy nhanh một truy vấn JQL để xem kết quả."
      />
    );
  }

  if (error && !issues) return null;

  if (!issues || issues.length === 0) {
    return (
      <EmptyState
        icon={<SearchX className="h-8 w-8" aria-hidden />}
        title="Không có công việc nào khớp"
        description="Bộ lọc hiện tại quá hẹp. Thử bớt điều kiện hoặc nới rộng khoảng giá trị rồi tìm lại."
      />
    );
  }

  const total = issues.length;
  const totalPages = Math.max(1, Math.ceil(total / RESULTS_PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * RESULTS_PAGE_SIZE;
  const pageItems = issues.slice(start, start + RESULTS_PAGE_SIZE);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-ink-strong">Kết quả</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {total} công việc
            {totalPages > 1 && ` · ${start + 1}–${Math.min(start + RESULTS_PAGE_SIZE, total)}`}
          </span>
          {wide && <ColumnPicker columns={columns} onToggle={toggle} />}
          {exportJql && (
            <ExportMenu
              items={[
                {
                  id: 'csv',
                  label: 'Kết quả (CSV)',
                  hint: wide
                    ? 'Đủ mọi công việc khớp, theo cột đang chọn'
                    : 'Đủ mọi công việc khớp',
                  run: () => exportIssuesCsvWithToast({ jql: exportJql, columns }),
                },
              ]}
            />
          )}
        </div>
      </div>

      {wide ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                {columns.map((id) => (
                  <th
                    key={id}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap px-3 py-2 first:pl-4 last:pr-4',
                      id === 'points' && 'text-right',
                    )}
                  >
                    {RESULT_COLUMNS.find((c) => c.id === id)!.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageItems.map((issue) => (
                <ResultRow
                  key={issue.id}
                  issue={issue}
                  columns={columns}
                  ctx={ctx}
                  onOpen={onOpen}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {pageItems.map((issue) => (
            <ResultCard key={issue.id} issue={issue} onOpen={onOpen} />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPageChange(current - 1)}
            disabled={current <= 1}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Trước
          </Button>
          <span className="text-xs text-muted" aria-live="polite">
            Trang {current}/{totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPageChange(current + 1)}
            disabled={current >= totalPages}
          >
            Sau
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

/** Nút "Cột" + hộp tick chọn cột (Mã và Tiêu đề luôn bật). */
function ColumnPicker({
  columns,
  onToggle,
}: {
  columns: ResultColumnId[];
  onToggle: (id: ResultColumnId) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="sm" title="Chọn cột hiển thị">
          <Columns3 className="h-4 w-4" aria-hidden />
          Cột
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-dropdown w-56 rounded-lg border border-border bg-surface p-2 shadow-lg outline-none"
        >
          <p className="px-2 pb-1 text-xs font-medium text-muted">Cột hiển thị</p>
          <ul className="flex flex-col">
            {RESULT_COLUMNS.map((c) => (
              <li key={c.id}>
                <label
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    c.locked ? 'text-faint' : 'cursor-pointer text-ink hover:bg-surface-2',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={columns.includes(c.id)}
                    disabled={c.locked}
                    onChange={() => onToggle(c.id)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  {c.label}
                  {c.locked && <span className="ml-auto text-[11px]">luôn hiện</span>}
                </label>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function StatusCell({ issue }: { issue: IssueDto }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: categoryColor(issue.status.category) }}
        aria-hidden
      />
      {issue.status.name}
    </span>
  );
}

function PersonCell({ person }: { person: IssueDto['assignee'] }) {
  if (!person) return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={person.displayName} src={person.avatarUrl} size={20} />
      <span className="max-w-[10rem] truncate">{person.displayName}</span>
    </span>
  );
}

function Cell({
  issue,
  col,
  ctx,
}: {
  issue: IssueDto;
  col: ResultColumnId;
  ctx: { projectKeyById: Map<string, string> };
}) {
  const text = cellText(issue, col, ctx);
  switch (col) {
    case 'key':
      return <span className="font-mono text-xs font-medium text-muted">{text}</span>;
    case 'summary':
      return <span className="block max-w-[32rem] truncate text-ink-strong">{text}</span>;
    case 'type':
      return <IssueTypeBadge name={issue.type.name} color={issue.type.color} />;
    case 'status':
      return <StatusCell issue={issue} />;
    case 'assignee':
      return <PersonCell person={issue.assignee} />;
    case 'reporter':
      return <PersonCell person={issue.reporter} />;
    case 'severity':
      return issue.severity ? <SeverityBadge severity={issue.severity} /> : <Empty />;
    case 'points':
      return <span className="block text-right tabular-nums">{text || <Empty />}</span>;
    case 'due':
      return text ? (
        <span className={cn(dueState(issue) === 'overdue' && 'font-medium text-danger')}>
          {text}
        </span>
      ) : (
        <Empty />
      );
    case 'project':
      return text ? (
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted">
          {text}
        </span>
      ) : (
        <Empty />
      );
    default:
      return text ? <>{text}</> : <Empty />;
  }
}

const Empty = () => <span className="text-faint">—</span>;

function ResultRow({
  issue,
  columns,
  ctx,
  onOpen,
}: {
  issue: IssueDto;
  columns: ResultColumnId[];
  ctx: { projectKeyById: Map<string, string> };
  onOpen: (key: string) => void;
}) {
  return (
    <tr
      tabIndex={0}
      data-nav-item
      aria-roledescription="dòng việc"
      onClick={(e: MouseEvent<HTMLTableRowElement>) => void openOnClick(e, issue.key, onOpen)}
      onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) =>
        void openOnRowKey(e, { key: issue.key, open: onOpen })
      }
      className="cursor-pointer transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
    >
      {columns.map((col) => (
        <td key={col} className="whitespace-nowrap px-3 py-2.5 first:pl-4 last:pr-4">
          <Cell issue={issue} col={col} ctx={ctx} />
        </td>
      ))}
    </tr>
  );
}

/** Dạng thẻ cho điện thoại: mã + tiêu đề, kèm hai chip trạng thái / người được giao — không cuộn ngang. */
function ResultCard({ issue, onOpen }: { issue: IssueDto; onOpen: (key: string) => void }) {
  return (
    <li>
      <button
        type="button"
        data-nav-item
        onClick={() => onOpen(issue.key)}
        className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      >
        <span className="flex items-baseline gap-2">
          <span className="shrink-0 font-mono text-xs font-medium text-muted">{issue.key}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-strong">{issue.summary}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <StatusCell issue={issue} />
          {issue.assignee ? <PersonCell person={issue.assignee} /> : null}
        </span>
      </button>
    </li>
  );
}
