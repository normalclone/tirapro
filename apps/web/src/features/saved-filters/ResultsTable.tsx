import { useEffect, useMemo, useRef } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronLeft, ChevronRight, Columns3, Filter as FilterIcon, SearchX } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { dueState } from '@/lib/dueDate';
import { IssueTypeBadge } from '@/components/ui/IssueTypeBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { exportIssuesCsvWithToast } from '@/features/export/api';
import { IssueKeyLink } from '@/features/issues/peek/IssueKeyLink';
import {
  PEEKED_ROW_CLS,
  PEEKED_TABLE_ROW_CLS,
  peekedAttrs,
} from '@/features/issues/peek/peekedRow';
import { rowPeekProps } from '@/features/issues/peek/rowPeekProps';
import { IssueContextMenu, IssueRowMenuButton } from '@/features/issues/menu/IssueContextMenu';
import { SelectCheckbox } from '@/features/bulk/SelectCheckbox';
import { categoryColor } from '@/lib/statusColor';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { RESULTS_PAGE_SIZE, resultCountLabel } from './resultPaging';
import { cn } from '@/lib/utils';
import { ColumnHeader } from './ColumnHeader';
import { RESULT_COLUMNS, cellText, isDefaultColumns, type ResultColumnId } from './resultColumns';
import { useResultColumns } from './useResultColumns';

/** Chọn nhiều cho bảng kết quả (trạng thái nằm ở trang; `useBulkSelection`). */
export interface RowSelection {
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Shift+click: chọn dải theo thứ tự các dòng đã nạp. */
  onRange: (id: string) => void;
  /** Chọn/bỏ chọn cả trang đang hiện. */
  onTogglePage: (ids: string[], on: boolean) => void;
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
  peekedKey = null,
  exportJql,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  scopeKey = 'adhoc',
  selection,
}: {
  issues: IssueDto[] | null;
  loading: boolean;
  hasRun: boolean;
  /** Truy vấn lỗi (cú pháp/giá trị): lỗi đã hiện ở ô JQL nên không hiện thêm "Không có công việc nào khớp". */
  error: string | null;
  page: number;
  onPageChange: (p: number) => void;
  projectKeyById: Map<string, string>;
  /** Bấm dòng/mã → xem nhanh ở panel phải (Cmd/Ctrl+bấm, chuột giữa → trang đầy đủ ở tab mới). */
  onOpen: (key: string) => void;
  /** Khoá việc đang xem nhanh → dòng/thẻ đó được tô + `aria-current`. */
  peekedKey?: string | null;
  /** JQL của kết quả đang xem; có thì hiện nút Xuất CSV (tải ĐỦ mọi dòng ở máy chủ, theo cột đang chọn). */
  exportJql?: string;
  /** Máy chủ còn kết quả sau phần đã nạp: nhãn đếm không ghi như tổng, có nút "Tải thêm" + gợi ý Xuất CSV. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Phạm vi nhớ bố cục cột: `adhoc` (JQL nhanh) hoặc `filter:<id>` (bộ lọc đã lưu). */
  scopeKey?: string;
  /** Chọn nhiều (hàng loạt): ô chọn ở đầu mỗi dòng/thẻ + ô "chọn tất cả trên trang". Không truyền = không chọn nhiều. */
  selection?: RowSelection;
}) {
  const cols = useResultColumns(scopeKey);
  const { columns } = cols;
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
        description="Chọn một bộ lọc đã lưu, hoặc chạy nhanh một truy vấn JQL để xem kết quả."
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
      <p className="sr-only" role="status">
        {cols.announce}
      </p>
      <ResultsToolbar
        countLabel={resultCountLabel(total, hasMore)}
        range={
          totalPages > 1 ? ` · ${start + 1}–${Math.min(start + RESULTS_PAGE_SIZE, total)}` : ''
        }
        hasMore={hasMore}
        wide={wide}
        columns={columns}
        onToggleColumn={cols.toggle}
        onResetColumns={cols.reset}
        exportJql={exportJql}
      />

      {wide ? (
        <ResultsGrid
          columns={columns}
          cols={cols}
          pageItems={pageItems}
          ctx={ctx}
          onOpen={onOpen}
          peekedKey={peekedKey}
          selection={selection}
        />
      ) : (
        <ul className="divide-y divide-border">
          {pageItems.map((issue) => (
            <ResultCard
              key={issue.id}
              issue={issue}
              onOpen={onOpen}
              peeked={peekedKey === issue.key}
              selection={selection}
            />
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
      {hasMore && onLoadMore && (
        <div className="flex justify-center border-t border-border px-4 py-2.5">
          <Button variant="secondary" size="sm" loading={loadingMore} onClick={onLoadMore}>
            Tải thêm
          </Button>
        </div>
      )}
    </div>
  );
}

/** Bảng kết quả (màn rộng): tiêu đề cột là nút mở menu sửa cột; cuộn ngang khi quá rộng. */
function ResultsGrid({
  columns,
  cols,
  pageItems,
  ctx,
  onOpen,
  peekedKey,
  selection,
}: {
  columns: ResultColumnId[];
  cols: ReturnType<typeof useResultColumns>;
  pageItems: IssueDto[];
  ctx: { projectKeyById: Map<string, string> };
  onOpen: (key: string) => void;
  peekedKey: string | null;
  selection?: RowSelection;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead ref={cols.theadRef}>
          <tr className="border-b border-border text-left text-xs font-medium text-muted">
            {selection && <SelectAllHeader pageItems={pageItems} selection={selection} />}
            {columns.map((id) => (
              <th
                key={id}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-3 py-2 first:pl-4 last:pr-4',
                  id === 'points' && 'text-right',
                )}
              >
                <ColumnHeader
                  id={id}
                  columns={columns}
                  onMove={cols.move}
                  onHide={cols.hide}
                  onShow={cols.show}
                />
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
              peeked={peekedKey === issue.key}
              selection={selection}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ô "chọn tất cả trên trang" ở đầu bảng; trạng thái lưng chừng (indeterminate) khi chỉ chọn một phần của trang. */
function SelectAllHeader({
  pageItems,
  selection,
}: {
  pageItems: IssueDto[];
  selection: RowSelection;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const n = pageItems.filter((i) => selection.selected.has(i.id)).length;
  const all = n > 0 && n === pageItems.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = n > 0 && !all;
  }, [n, all]);
  return (
    <th scope="col" className="w-10 py-2 pl-4 pr-0" data-no-peek>
      <input
        ref={ref}
        type="checkbox"
        checked={all}
        onChange={() =>
          selection.onTogglePage(
            pageItems.map((i) => i.id),
            !all,
          )
        }
        aria-label="Chọn tất cả trên trang"
        title="Chọn tất cả việc trên trang này"
        className="h-4 w-4 cursor-pointer accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:h-5 [@media(pointer:coarse)]:w-5"
      />
    </th>
  );
}

/** Thanh đầu bảng kết quả: nhãn đếm (không ghi số bị cắt như tổng), chọn cột, xuất CSV, gợi ý khi còn nữa. */
function ResultsToolbar({
  countLabel,
  range,
  hasMore,
  wide,
  columns,
  onToggleColumn,
  onResetColumns,
  exportJql,
}: {
  countLabel: string;
  range: string;
  hasMore: boolean;
  wide: boolean;
  columns: ResultColumnId[];
  onToggleColumn: (id: ResultColumnId) => void;
  onResetColumns: () => void;
  exportJql?: string;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-ink-strong">Kết quả</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {countLabel}
            {range}
          </span>
          {wide && (
            <ColumnPicker columns={columns} onToggle={onToggleColumn} onReset={onResetColumns} />
          )}
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
      {hasMore && (
        <p className="border-b border-border bg-surface-2 px-4 py-1.5 text-xs text-muted">
          Còn nhiều công việc khớp hơn số đang hiện.
          {exportJql
            ? ' Bấm “Tải thêm” để xem tiếp, hoặc Xuất CSV để lấy đủ.'
            : ' Bấm “Tải thêm” để xem tiếp.'}
        </p>
      )}
    </>
  );
}

/** Nút "Cột" + hộp tick chọn cột (Mã và Tiêu đề luôn bật). */
function ColumnPicker({
  columns,
  onToggle,
  onReset,
}: {
  columns: ResultColumnId[];
  onToggle: (id: ResultColumnId) => void;
  onReset: () => void;
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
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              onClick={onReset}
              disabled={isDefaultColumns(columns)}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent [@media(pointer:coarse)]:min-h-11"
            >
              Đặt lại mặc định
            </button>
          </div>
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
  onPeek,
}: {
  issue: IssueDto;
  col: ResultColumnId;
  ctx: { projectKeyById: Map<string, string> };
  onPeek: (key: string) => void;
}) {
  const text = cellText(issue, col, ctx);
  switch (col) {
    case 'key':
      // Link thật: bấm = xem nhanh, Cmd/Ctrl+bấm / chuột giữa = trang đầy đủ ở tab mới (chuột phải → "Mở trong tab mới").
      return (
        <IssueKeyLink issueKey={issue.key} onPeek={onPeek} className="font-medium">
          {text}
        </IssueKeyLink>
      );
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
  peeked,
  selection,
}: {
  issue: IssueDto;
  columns: ResultColumnId[];
  ctx: { projectKeyById: Map<string, string> };
  onOpen: (key: string) => void;
  peeked: boolean;
  selection?: RowSelection;
}) {
  const checked = selection?.selected.has(issue.id) ?? false;
  const anySelected = (selection?.selected.size ?? 0) > 0;
  return (
    <IssueContextMenu issue={issue} surface="filters" onPeek={onOpen}>
      <tr
        tabIndex={0}
        data-nav-item
        data-issue-key={issue.key}
        aria-roledescription="dòng việc"
        data-selected={checked ? '' : undefined}
        {...peekedAttrs(peeked)}
        {...rowPeekProps(issue.key, onOpen)}
        className={cn(
          'group/row cursor-pointer transition-colors focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
          // Đang xem: nền token KHÔNG đổi khi rê chuột (hover thường sẽ đè lên và dòng đang xem biến mất).
          peeked
            ? PEEKED_TABLE_ROW_CLS
            : checked
              ? 'bg-primary-subtle hover:bg-primary-subtle'
              : 'hover:bg-surface-2',
        )}
      >
        {selection && (
          <td className="w-10 py-2.5 pl-4 pr-0" data-no-peek>
            <SelectCheckbox
              placement="inline"
              issueKey={issue.key}
              checked={checked}
              alwaysVisible={anySelected}
              onToggle={() => selection.onToggle(issue.id)}
              onRange={() => selection.onRange(issue.id)}
            />
          </td>
        )}
        {columns.map((col) => (
          <td key={col} className="whitespace-nowrap px-3 py-2.5 first:pl-4 last:pr-4">
            {col === 'key' ? (
              // Mã + nút "…" (menu công việc): nút chỉ hiện khi rê/focus dòng, luôn hiện trên cảm ứng.
              <span className="inline-flex items-center gap-1">
                <Cell issue={issue} col={col} ctx={ctx} onPeek={onOpen} />
                <IssueRowMenuButton issue={issue} surface="filters" onPeek={onOpen} />
              </span>
            ) : (
              <Cell issue={issue} col={col} ctx={ctx} onPeek={onOpen} />
            )}
          </td>
        ))}
      </tr>
    </IssueContextMenu>
  );
}

/** Dạng thẻ cho điện thoại: mã + tiêu đề, kèm hai chip trạng thái / người được giao — không cuộn ngang. */
function ResultCard({
  issue,
  onOpen,
  peeked,
  selection,
}: {
  issue: IssueDto;
  onOpen: (key: string) => void;
  peeked: boolean;
  selection?: RowSelection;
}) {
  const checked = selection?.selected.has(issue.id) ?? false;
  return (
    <IssueContextMenu issue={issue} surface="filters" onPeek={onOpen}>
      <li
        className={cn('group/row relative', checked && 'bg-primary-subtle')}
        data-selected={checked ? '' : undefined}
      >
        {selection && (
          // Điện thoại: ô chọn luôn hiện (vùng bấm 44px), nằm cạnh nút thẻ chứ không lồng trong nó.
          <span className="absolute left-3 top-3.5 z-10">
            <SelectCheckbox
              placement="inline"
              issueKey={issue.key}
              checked={checked}
              alwaysVisible
              onToggle={() => selection.onToggle(issue.id)}
              onRange={() => selection.onRange(issue.id)}
            />
          </span>
        )}
        <span className="absolute right-2 top-2 z-10">
          <IssueRowMenuButton issue={issue} surface="filters" onPeek={onOpen} />
        </span>
        <button
          type="button"
          data-nav-item
          data-issue-key={issue.key}
          {...peekedAttrs(peeked)}
          {...rowPeekProps(issue.key, onOpen)}
          className={cn(
            'flex w-full flex-col gap-1.5 py-3 pr-12 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none',
            selection ? 'pl-11' : 'pl-4',
            peeked && PEEKED_ROW_CLS,
          )}
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
    </IssueContextMenu>
  );
}
