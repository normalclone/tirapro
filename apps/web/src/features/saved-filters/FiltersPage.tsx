import { useEffect, useMemo, useRef, useState, type FormEvent, type ComponentProps } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import { Bookmark, ChevronDown, Filter as FilterIcon, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { useOpenSession } from '@/lib/useOpenSession';
import { Dialog } from '@/components/ui/Dialog';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useConfirm } from '@/components/ui/useConfirm';
import { Input } from '@/components/ui/Input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useProjects } from '@/features/projects/api';
import { useAuth } from '@/stores/auth';
import { JqlEditor } from './JqlEditor';
import { ResultsTable } from './ResultsTable';
import { appendResults, type ResultSet } from './resultPaging';
import { QueryBuilder } from './QueryBuilder';
import {
  useCreateFilter,
  useDeleteFilter,
  useJqlValidation,
  useRunFilter,
  fetchFilterPage,
  fetchJqlPage,
  useRunJql,
  useSavedFilters,
  type FilterVisibility,
  type SavedFilter,
} from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';

type BuilderMode = 'simple' | 'jql';

const VISIBILITY_LABEL: Record<FilterVisibility, string> = {
  PRIVATE: 'Riêng tư',
  WORKSPACE: 'Cả tổ chức',
  PROJECT: 'Dự án',
};

const PLACEHOLDER = 'project = DEMO AND status = "In Progress" ORDER BY created DESC';

/** Nguồn kết quả đang hiển thị ở khu nội dung. */
type ActiveSource =
  | { kind: 'none' }
  | { kind: 'filter'; filter: SavedFilter }
  | { kind: 'adhoc'; jql: string };

/** Lưu bộ lọc mới, báo kết quả bằng toast; trả `true` khi thành công (để modal tự đóng). */
async function saveWithToast(
  save: (input: { name: string; jql: string; visibility: FilterVisibility }) => Promise<unknown>,
  name: string,
  jql: string,
  visibility: FilterVisibility,
): Promise<boolean> {
  try {
    await save({ name, jql, visibility });
    toast.success(`Đã lưu bộ lọc "${name}".`);
    return true;
  } catch (e) {
    toast.error(apiErrorMessage(e));
    return false;
  }
}

// eslint-disable-next-line max-lines-per-function -- U17/U18 dựng cả bộ lọc + bảng kết quả trong một trang (173 dòng); tách trang là việc riêng
export function FiltersPage() {
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const canManageFilters = useAuth((s) => s.can('filter:manage'));

  const [active, setActive] = useState<ActiveSource>({ kind: 'none' });
  const [results, setResults] = useState<ResultSet | null>(null);
  // Các trang đã nạp THÊM sau trang đầu ("Tải thêm"); đổi nguồn/chạy lại thì bỏ.
  const [more, setMore] = useState<ResultSet | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  // JQL đổ sẵn vào hộp "Tạo bộ lọc" (nút "Lưu truy vấn" cạnh "Chạy JQL"); '' = mở hộp trống.
  const [createInitialJql, setCreateInitialJql] = useState('');
  const [searchParams] = useSearchParams();
  const urlJql = searchParams.get('jql')?.trim() ?? '';

  // Ô nhập JQL nhanh (ad-hoc) trong khu nội dung.
  const [jqlDraft, setJqlDraft] = useState('');
  const [adhocJql, setAdhocJql] = useState('');

  const adhoc = useRunJql(adhocJql, adhocJql.length > 0);
  const savedFilters = useSavedFilters();
  const createFilter = useCreateFilter();
  const deleteFilter = useDeleteFilter();
  const confirm = useConfirm();
  const runFilter = useRunFilter();

  // Bản đồ projectId -> projectKey để điều hướng về bảng của issue.
  const projectKeyById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects ?? []) m.set(p.id, p.key);
    return m;
  }, [projects]);

  // Kết quả ad-hoc lấy trực tiếp từ query; kết quả bộ lọc đã lưu giữ trong state.
  const baseResults = active.kind === 'adhoc' ? (adhoc.data ?? null) : results;
  // Đổi bộ lọc/chạy lại trong lúc đang "Tải thêm": trang về trễ của nguồn cũ bị bỏ (so `loadSeq`).
  const loadSeq = useRef(0);
  useEffect(() => {
    loadSeq.current += 1;
    setMore(null);
    setLoadingMore(false);
  }, [baseResults]);
  const shownSet = baseResults ? (more ? appendResults(baseResults, more) : baseResults) : null;
  const shownResults: IssueDto[] | null = shownSet?.items ?? null;

  // Đổi nguồn kết quả → về trang 1.
  useEffect(() => {
    setPage(1);
  }, [active, shownResults]);

  // `?jql=…` trên URL (vd "Xem tất cả" từ trang chủ) → điền vào ô và chạy ngay; chỉ áp lại khi tham số đổi.
  useEffect(() => {
    if (!urlJql) return;
    setJqlDraft(urlJql);
    setResults(null);
    setActive({ kind: 'adhoc', jql: urlJql });
    setAdhocJql(urlJql);
  }, [urlJql]);

  async function loadMore() {
    if (!shownSet?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    const seq = loadSeq.current;
    try {
      const next =
        active.kind === 'adhoc'
          ? await fetchJqlPage(active.jql, shownSet.nextCursor)
          : active.kind === 'filter'
            ? await fetchFilterPage(active.filter.id, shownSet.nextCursor)
            : null;
      if (seq !== loadSeq.current) return; // nguồn đã đổi
      if (next && baseResults) setMore((m) => (m ? appendResults(m, next) : next));
    } catch (e) {
      if (seq === loadSeq.current) toast.error(apiErrorMessage(e));
    } finally {
      if (seq === loadSeq.current) setLoadingMore(false);
    }
  }

  async function loadAndRunSaved(f: SavedFilter) {
    setJqlDraft(f.jql); // hiện đúng câu JQL của bộ lọc để người dùng học cú pháp / chỉnh rồi "Lưu truy vấn"
    setAdhocJql(''); // dừng truy vấn ad-hoc
    setResults(null);
    setActive({ kind: 'filter', filter: f });
    try {
      setResults(await runFilter.mutateAsync(f.id));
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

  function openIssue(key: string) {
    navigate(`/issue/${key}`);
  }

  async function handleDelete(f: SavedFilter) {
    if (!(await confirm({ title: `Xoá bộ lọc "${f.name}"?`, destructive: true }))) return;
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
          <h1 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint max-lg:sr-only">
            <Bookmark className="h-3.5 w-3.5" aria-hidden />
            Bộ lọc đã lưu
          </h1>
          {/* < lg: rail thu thành một nút (mặc định đóng) để thấy ô JQL ngay; mở ra xổ danh sách tại chỗ. */}
          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            aria-expanded={railOpen}
            aria-controls="saved-filters-body"
            className="flex min-h-9 w-full items-center gap-1.5 rounded-md px-1 text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] lg:hidden"
          >
            <Bookmark className="h-4 w-4 text-faint" aria-hidden />
            <span>
              Bộ lọc đã lưu
              {savedFilters.data ? ` (${savedFilters.data.length})` : ''}
            </span>
            <ChevronDown
              className={cn(
                'ml-auto h-4 w-4 text-faint transition-transform',
                railOpen && 'rotate-180',
              )}
              aria-hidden
            />
          </button>
        </div>

        <div
          id="saved-filters-body"
          className={cn('flex flex-col gap-2', !railOpen && 'max-lg:hidden')}
        >
          {canManageFilters && (
            <Button
              size="sm"
              onClick={() => {
                setCreateInitialJql('');
                setCreateOpen(true);
              }}
              className="w-full"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Tạo bộ lọc
            </Button>
          )}

          <SavedFilterList
            query={savedFilters}
            activeId={activeFilterId}
            onSelect={(f) => {
              setRailOpen(false);
              void loadAndRunSaved(f);
            }}
            onDelete={handleDelete}
            canManage={canManageFilters}
            deleting={deleteFilter.isPending ? deleteFilter.variables : undefined}
          />
        </div>
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
            onSave={
              canManageFilters
                ? () => {
                    setCreateInitialJql(jqlDraft.trim());
                    setCreateOpen(true);
                  }
                : undefined
            }
          />

          <ResultsTable
            issues={shownResults}
            loading={isRunning}
            hasRun={hasRun}
            error={runError}
            page={page}
            onPageChange={setPage}
            projectKeyById={projectKeyById}
            onOpen={openIssue}
            hasMore={shownSet?.hasMore ?? false}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMore()}
            exportJql={
              active.kind === 'adhoc'
                ? active.jql
                : active.kind === 'filter'
                  ? active.filter.jql
                  : undefined
            }
          />
        </div>
      </div>

      {canManageFilters && (
        <CreateFilterModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          initialJql={createInitialJql}
          saving={createFilter.isPending}
          onSave={(name, jql, visibility) =>
            saveWithToast(createFilter.mutateAsync, name, jql, visibility)
          }
        />
      )}
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
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  running: boolean;
  error: string | null;
  /** Mở hộp "Tạo bộ lọc" với JQL đang gõ; undefined = không có quyền `filter:manage` → ẩn nút. */
  onSave?: () => void;
}) {
  const { validation } = useJqlValidation(value);
  // Lỗi chạy gần nhất không lặp lại khi ô đã báo lỗi cho cùng câu (cú pháp/giá trị sai).
  const showRunError = error && !(validation && !validation.valid);
  const empty = !value.trim();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <JqlEditor
            id="adhoc-jql"
            label="Chạy nhanh truy vấn JQL"
            value={value}
            onChange={onChange}
            onRun={onRun}
            rows={2}
            placeholder={PLACEHOLDER}
          />
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={onRun} loading={running} disabled={empty}>
            {!running && <Play className="h-4 w-4" aria-hidden />}
            Chạy JQL
          </Button>
          {onSave && (
            <Button size="sm" variant="secondary" onClick={onSave} disabled={empty}>
              <Bookmark className="h-4 w-4" aria-hidden />
              Lưu truy vấn
            </Button>
          )}
        </div>
      </div>

      {showRunError && (
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
  query,
  activeId,
  onSelect,
  onDelete,
  canManage,
  deleting,
}: {
  query: UseQueryResult<SavedFilter[]>;
  activeId: string | null;
  onSelect: (f: SavedFilter) => void;
  onDelete: (f: SavedFilter) => void;
  canManage: boolean;
  deleting: string | undefined;
}) {
  return (
    <QueryBoundary
      query={query}
      skeleton={
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      }
      empty={(d) => d.length === 0}
      emptyState={
        <EmptyState
          icon={<FilterIcon className="h-6 w-6" />}
          title={canManage ? 'Chưa có bộ lọc nào' : 'Chưa có bộ lọc nào được chia sẻ với bạn'}
          description={canManage ? 'Bấm “Tạo bộ lọc” để lưu một truy vấn.' : undefined}
        />
      }
    >
      {(filters) => (
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
                  {f.isOwner && canManage && (
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
      )}
    </QueryBoundary>
  );
}

/* ------------------------------------------------------------------ */
/* Modal tạo bộ lọc                                                    */
/* ------------------------------------------------------------------ */

/**
 * Luôn mount (có hiệu ứng đóng); `key` theo lần mở → mỗi lần mở là mount mới nên form khởi tạo lại, không có
 * khung hình nội dung cũ. Lúc đóng `key` giữ nguyên nên nội dung ở lại suốt hiệu ứng.
 */
function CreateFilterModal(props: ComponentProps<typeof CreateFilterModalInner>) {
  const session = useOpenSession(props.open);
  return <CreateFilterModalInner key={session} {...props} />;
}

function CreateFilterModalInner({
  open,
  onClose,
  onSave,
  saving,
  initialJql,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, jql: string, visibility: FilterVisibility) => Promise<boolean>;
  saving: boolean;
  /** Có JQL đổ sẵn → mở thẳng tab JQL (bộ dựng "Đơn giản" không đọc ngược được JQL tuỳ ý). */
  initialJql: string;
}) {
  const [mode, setMode] = useState<BuilderMode>(initialJql ? 'jql' : 'simple');
  const [jql, setJql] = useState(initialJql);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<FilterVisibility>('PRIVATE');

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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Tạo bộ lọc"
      icon={<FilterIcon className="h-4 w-4" />}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" form="create-filter-form" loading={saving} disabled={!canSubmit}>
            Lưu bộ lọc
          </Button>
        </>
      }
    >
      <form id="create-filter-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <SegmentedControl
            ariaLabel="Chế độ tạo bộ lọc"
            fullWidth={false}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'simple', label: 'Đơn giản' },
              { value: 'jql', label: 'JQL' },
            ]}
          />
          <span className="text-xs text-faint">
            {mode === 'simple' ? 'Cho người mới — sinh JQL tự động' : 'Cho người thạo cú pháp'}
          </span>
        </div>

        {mode === 'simple' ? (
          <QueryBuilder value={jql} onChange={setJql} onEditAsJql={() => setMode('jql')} />
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="create-jql" className="text-sm font-medium text-muted">
              Truy vấn JQL
            </label>
            <JqlEditor
              id="create-jql"
              value={jql}
              onChange={setJql}
              rows={3}
              placeholder={PLACEHOLDER}
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
      </form>
    </Dialog>
  );
}
