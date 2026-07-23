import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Filter as FilterIcon,
  Play,
  Plus,
  SearchX,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto, UserDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { pageContainer } from '@/components/layout/page';
import { categoryColor } from '@/lib/statusColor';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useProjects } from '@/features/projects/api';
import { QueryBuilder, Segmented } from './QueryBuilder';
import {
  useCreateFilter,
  useDeleteFilter,
  useRunFilter,
  useRunJql,
  useSavedFilters,
  type FilterVisibility,
  type SavedFilter,
} from './api';

type BuilderMode = 'simple' | 'jql';

const PAGE_SIZE = 25;

const VISIBILITY_LABEL: Record<FilterVisibility, string> = {
  PRIVATE: 'Riêng tư',
  WORKSPACE: 'Workspace',
  PROJECT: 'Dự án',
};

const PLACEHOLDER = 'project = DEMO AND status = "In Progress" ORDER BY created DESC';

/** Nguồn kết quả đang hiển thị ở khu nội dung. */
type ActiveSource =
  | { kind: 'none' }
  | { kind: 'filter'; filter: SavedFilter }
  | { kind: 'adhoc'; jql: string };

export function FiltersPage() {
  const navigate = useNavigate();
  const { data: projects } = useProjects();

  const [active, setActive] = useState<ActiveSource>({ kind: 'none' });
  const [results, setResults] = useState<IssueDto[] | null>(null);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  // Ô nhập JQL nhanh (ad-hoc) trong khu nội dung.
  const [jqlDraft, setJqlDraft] = useState('');
  const [adhocJql, setAdhocJql] = useState('');

  const adhoc = useRunJql(adhocJql, adhocJql.length > 0);
  const savedFilters = useSavedFilters();
  const createFilter = useCreateFilter();
  const deleteFilter = useDeleteFilter();
  const runFilter = useRunFilter();

  // Bản đồ projectId -> projectKey để điều hướng về bảng của issue.
  const projectKeyById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects ?? []) m.set(p.id, p.key);
    return m;
  }, [projects]);

  // Kết quả ad-hoc lấy trực tiếp từ query; kết quả bộ lọc đã lưu giữ trong state.
  const shownResults = active.kind === 'adhoc' ? (adhoc.data ?? null) : results;

  // Đổi nguồn kết quả → về trang 1.
  useEffect(() => {
    setPage(1);
  }, [active, shownResults]);

  async function loadAndRunSaved(f: SavedFilter) {
    setAdhocJql(''); // dừng truy vấn ad-hoc
    setResults(null);
    setActive({ kind: 'filter', filter: f });
    try {
      const issues = await runFilter.mutateAsync(f.id);
      setResults(issues);
    } catch (e) {
      toast.error(apiErrorMessage(e));
      setActive({ kind: 'none' });
    }
  }

  function runAdhoc() {
    const jql = jqlDraft.trim();
    if (!jql) return;
    setResults(null);
    setActive({ kind: 'adhoc', jql });
    setAdhocJql(jql);
  }

  function openIssue(issue: IssueDto) {
    navigate(`/issue/${issue.key}`);
  }

  async function handleDelete(f: SavedFilter) {
    if (!window.confirm(`Xoá bộ lọc "${f.name}"?`)) return;
    try {
      await deleteFilter.mutateAsync(f.id);
      toast.success('Đã xoá bộ lọc.');
      if (active.kind === 'filter' && active.filter.id === f.id) {
        setActive({ kind: 'none' });
        setResults(null);
      }
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  const isRunning = active.kind === 'adhoc' ? adhoc.isFetching : runFilter.isPending;
  const runError = active.kind === 'adhoc' && adhoc.error ? apiErrorMessage(adhoc.error) : null;
  const hasRun = active.kind !== 'none';

  const activeFilterId = active.kind === 'filter' ? active.filter.id : null;
  const heading =
    active.kind === 'filter'
      ? active.filter.name
      : active.kind === 'adhoc'
        ? 'Kết quả JQL'
        : 'Bộ lọc';

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Rail: danh sách bộ lọc — dọc trên desktop, hàng cuộn ngang trên mobile */}
      <aside
        aria-label="Bộ lọc đã lưu"
        className={cn(
          'shrink-0 border-border bg-surface',
          'flex flex-col gap-2 border-b px-3 py-3',
          'lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5',
        )}
      >
        <div className="flex items-center justify-between gap-2 px-1 lg:px-2">
          <h1 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
            <Bookmark className="h-3.5 w-3.5" aria-hidden />
            Bộ lọc đã lưu
          </h1>
        </div>

        <Button size="sm" onClick={() => setCreateOpen(true)} className="w-full">
          <Plus className="h-4 w-4" aria-hidden />
          Tạo bộ lọc
        </Button>

        <SavedFilterList
          filters={savedFilters.data}
          loading={savedFilters.isLoading}
          activeId={activeFilterId}
          onSelect={loadAndRunSaved}
          onDelete={handleDelete}
          deleting={deleteFilter.isPending ? deleteFilter.variables : undefined}
        />
      </aside>

      {/* Nội dung: JQL nhanh + kết quả có phân trang */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className={pageContainer('md', 'flex flex-col gap-5')}>
          <header className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <FilterIcon className="h-5 w-5 text-muted" aria-hidden />
              <h2 className="truncate text-xl font-semibold text-ink-strong">{heading}</h2>
            </div>
            <p className="text-sm text-muted">
              Chọn một bộ lọc bên trái để xem kết quả, hoặc chạy nhanh một truy vấn JQL bên dưới.
            </p>
          </header>

          <AdhocBar
            value={jqlDraft}
            onChange={setJqlDraft}
            onRun={runAdhoc}
            running={active.kind === 'adhoc' && isRunning}
            error={runError}
          />

          <Results
            issues={shownResults}
            loading={isRunning}
            hasRun={hasRun}
            page={page}
            onPageChange={setPage}
            projectKeyById={projectKeyById}
            onOpen={openIssue}
          />
        </div>
      </div>

      <CreateFilterModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        saving={createFilter.isPending}
        onSave={async (name, jql, visibility) => {
          try {
            await createFilter.mutateAsync({ name, jql, visibility });
            toast.success(`Đã lưu bộ lọc "${name}".`);
            return true;
          } catch (e) {
            toast.error(apiErrorMessage(e));
            return false;
          }
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Thanh JQL nhanh (ad-hoc)                                            */
/* ------------------------------------------------------------------ */

function AdhocBar({
  value,
  onChange,
  onRun,
  running,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  running: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <label htmlFor="adhoc-jql" className="sr-only">
            Chạy nhanh truy vấn JQL
          </label>
          <textarea
            id="adhoc-jql"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter để chạy nhanh.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onRun();
              }
            }}
            rows={2}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className={cn(
              'w-full resize-y rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-ink',
              'placeholder:text-faint transition-colors duration-150',
              'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            )}
          />
        </div>
        <Button
          size="sm"
          onClick={onRun}
          loading={running}
          disabled={!value.trim()}
          className="sm:mt-0"
        >
          {!running && <Play className="h-4 w-4" aria-hidden />}
          Chạy JQL
        </Button>
      </div>

      {error && (
        <p
          className="rounded-md border border-danger/40 bg-surface-2 px-3 py-2 font-mono text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rail: danh sách bộ lọc đã lưu                                       */
/* ------------------------------------------------------------------ */

function SavedFilterList({
  filters,
  loading,
  activeId,
  onSelect,
  onDelete,
  deleting,
}: {
  filters: SavedFilter[] | undefined;
  loading: boolean;
  activeId: string | null;
  onSelect: (f: SavedFilter) => void;
  onDelete: (f: SavedFilter) => void;
  deleting: string | undefined;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (!filters || filters.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
        Chưa có bộ lọc nào. Bấm “Tạo bộ lọc” để lưu một truy vấn.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {filters.map((f) => {
        const isActive = activeId === f.id;
        return (
          <li key={f.id}>
            <div
              className={cn(
                'group flex items-center gap-2 rounded-md px-2 py-2 transition-colors',
                isActive ? 'bg-primary-subtle' : 'hover:bg-surface-2',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(f)}
                aria-current={isActive ? 'true' : undefined}
                className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <span
                  className={cn(
                    'block truncate text-sm font-medium',
                    isActive ? 'text-primary' : 'text-ink-strong',
                  )}
                >
                  {f.name}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <Badge className="bg-surface-2 text-muted">
                    {VISIBILITY_LABEL[f.visibility]}
                  </Badge>
                </span>
              </button>
              {f.isOwner && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(f)}
                  loading={deleting === f.id}
                  aria-label={`Xoá bộ lọc ${f.name}`}
                  className="h-7 w-7 shrink-0 text-muted opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  {deleting !== f.id && <Trash2 className="h-4 w-4" aria-hidden />}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Modal tạo bộ lọc                                                    */
/* ------------------------------------------------------------------ */

function CreateFilterModal({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, jql: string, visibility: FilterVisibility) => Promise<boolean>;
  saving: boolean;
}) {
  const [mode, setMode] = useState<BuilderMode>('simple');
  const [jql, setJql] = useState('');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<FilterVisibility>('PRIVATE');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setMode('simple');
      setJql('');
      setName('');
      setVisibility('PRIVATE');
    }
  }, [open]);

  if (!open) return null;

  const trimmedName = name.trim();
  const trimmedJql = jql.trim();
  const canSubmit = trimmedName.length > 0 && trimmedJql.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await onSave(trimmedName, trimmedJql, visibility);
    if (ok) onClose();
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button
        className="absolute inset-0 bg-black/30 animate-in fade-in duration-200"
        onClick={onClose}
        aria-label="Đóng"
      />
      <div className="relative flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <FilterIcon className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-sm font-medium text-ink">Tạo bộ lọc</span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={onClose}
            aria-label="Đóng"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </header>

        <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <Segmented
                value={mode}
                onChange={(v) => setMode(v as BuilderMode)}
                options={[
                  { value: 'simple', label: 'Đơn giản' },
                  { value: 'jql', label: 'JQL' },
                ]}
              />
              <span className="text-xs text-faint">
                {mode === 'simple'
                  ? 'Cho người mới — sinh JQL tự động'
                  : 'Cho người thạo cú pháp'}
              </span>
            </div>

            {mode === 'simple' ? (
              <QueryBuilder value={jql} onChange={setJql} onEditAsJql={() => setMode('jql')} />
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor="create-jql" className="text-sm font-medium text-muted">
                  Truy vấn JQL
                </label>
                <textarea
                  id="create-jql"
                  value={jql}
                  onChange={(e) => setJql(e.target.value)}
                  rows={3}
                  placeholder={PLACEHOLDER}
                  spellCheck={false}
                  className={cn(
                    'w-full resize-y rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-ink',
                    'placeholder:text-faint transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  )}
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
              <div>
                <label htmlFor="create-name" className="mb-1.5 block text-sm font-medium text-muted">
                  Tên bộ lọc
                </label>
                <Input
                  id="create-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Việc của tôi tuần này"
                  className="text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="create-visibility"
                  className="mb-1.5 block text-sm font-medium text-muted"
                >
                  Phạm vi chia sẻ
                </label>
                <select
                  id="create-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as FilterVisibility)}
                  className={cn(
                    'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-ink',
                    'transition-colors focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  )}
                >
                  <option value="PRIVATE">{VISIBILITY_LABEL.PRIVATE}</option>
                  <option value="WORKSPACE">{VISIBILITY_LABEL.WORKSPACE}</option>
                  <option value="PROJECT">{VISIBILITY_LABEL.PROJECT}</option>
                </select>
              </div>
            </div>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" loading={saving} disabled={!canSubmit}>
              Lưu bộ lọc
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kết quả + phân trang phía client                                    */
/* ------------------------------------------------------------------ */

function Results({
  issues,
  loading,
  hasRun,
  page,
  onPageChange,
  projectKeyById,
  onOpen,
}: {
  issues: IssueDto[] | null;
  loading: boolean;
  hasRun: boolean;
  page: number;
  onPageChange: (p: number) => void;
  projectKeyById: Map<string, string>;
  onOpen: (issue: IssueDto) => void;
}) {
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

  if (!issues || issues.length === 0) {
    return (
      <EmptyState
        icon={<SearchX className="h-8 w-8" aria-hidden />}
        title="Không có issue nào khớp"
        description="Thử nới lỏng điều kiện truy vấn của bạn."
      />
    );
  }

  const total = issues.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const pageItems = issues.slice(start, start + PAGE_SIZE);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-ink-strong">Kết quả</span>
        <span className="text-xs text-muted">
          {total} issue
          {totalPages > 1 && (
            <>
              {' · '}
              {start + 1}–{Math.min(start + PAGE_SIZE, total)}
            </>
          )}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {pageItems.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            projectKey={projectKeyById.get(issue.projectId)}
            onOpen={onOpen}
          />
        ))}
      </ul>

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

function IssueRow({
  issue,
  projectKey,
  onOpen,
}: {
  issue: IssueDto;
  projectKey: string | undefined;
  onOpen: (issue: IssueDto) => void;
}) {
  const dot = categoryColor(issue.status.category);
  const assignee: UserDto | null | undefined = issue.assignee;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(issue)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: dot }}
          title={issue.status.name}
          aria-hidden
        />
        <span className="shrink-0 font-mono text-xs font-medium text-muted">{issue.key}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-strong">{issue.summary}</span>
        {issue.priority && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: issue.priority.color ?? 'var(--status-todo)' }}
            title={issue.priority.name}
            aria-hidden
          />
        )}
        {assignee ? (
          <Avatar name={assignee.displayName} src={assignee.avatarUrl} size={22} />
        ) : (
          <span
            className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-border"
            title="Chưa có người được giao"
            aria-hidden
          />
        )}
        {projectKey && (
          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted">
            {projectKey}
          </span>
        )}
      </button>
    </li>
  );
}
