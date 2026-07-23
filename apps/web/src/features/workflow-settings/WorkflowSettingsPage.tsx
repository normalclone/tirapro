import { useMemo, useState } from 'react';
import {
  GitBranch,
  Plus,
  Trash2,
  ChevronRight,
  ArrowRight,
  Circle,
  CircleDot,
  Flag,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { WorkflowGraph } from './WorkflowGraph';
import {
  useWorkflows,
  useCreateWorkflow,
  useDeleteWorkflow,
  useUpdateStatus,
  useAddStatus,
  useDeleteStatus,
  useAddTransition,
  useDeleteTransition,
  type Workflow,
  type WorkflowStatus,
  type WorkflowTransition,
  type StatusCategory,
} from './api';

/* ------------------------------------------------------------------ */
/* Hằng số phân loại trạng thái                                       */
/* ------------------------------------------------------------------ */

const CATEGORY_VAR: Record<StatusCategory, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

const CATEGORY_LABEL: Record<StatusCategory, string> = {
  TODO: 'Cần làm',
  IN_PROGRESS: 'Đang làm',
  DONE: 'Hoàn thành',
};

const CATEGORY_OPTIONS: StatusCategory[] = ['TODO', 'IN_PROGRESS', 'DONE'];

const DEFAULT_STATUS_COLOR = '#64748b';

/* ------------------------------------------------------------------ */
/* Trang chính                                                         */
/* ------------------------------------------------------------------ */

export function WorkflowSettingsPage() {
  const { data, isLoading } = useWorkflows();
  const createWorkflow = useCreateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');

  const workflows = data ?? [];
  const selected = workflows.find((w) => w.id === selectedId) ?? null;

  function resetAdd() {
    setName('');
    setDescription('');
    setProjectId('');
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên workflow.');
      return;
    }
    createWorkflow.mutate(
      {
        name: trimmed,
        description: description.trim() === '' ? undefined : description.trim(),
        projectId: projectId.trim() === '' ? undefined : projectId.trim(),
      },
      {
        onSuccess: (wf) => {
          resetAdd();
          setSelectedId(wf.id);
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function handleDeleteWorkflow(wf: Workflow) {
    if (
      !window.confirm(
        `Xoá workflow "${wf.name}"? Hành động này không thể hoàn tác.`,
      )
    )
      return;
    deleteWorkflow.mutate(wf.id, {
      onSuccess: () => {
        if (selectedId === wf.id) setSelectedId(null);
      },
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <div className={pageContainer('lg')}>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">
          Cấu hình Workflow
        </h1>
        <p className="mt-1 text-sm text-muted">
          Quản lý quy trình làm việc: trạng thái và các bước chuyển trạng thái của issue.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-surface">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
              <GitBranch className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink-strong">Workflow</h2>
              <p className="mt-0.5 text-sm text-muted">
                Chọn một workflow để xem và chỉnh sửa chi tiết.
              </p>
            </div>
          </div>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Tạo workflow
            </Button>
          )}
        </div>

        <div className="p-5">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : workflows.length === 0 && !adding ? (
            <EmptyState
              icon={<GitBranch className="h-6 w-6" />}
              title="Chưa có workflow nào"
              description="Tạo workflow đầu tiên để định nghĩa quy trình cho issue."
              action={
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" />
                  Tạo workflow
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {workflows.map((wf) => (
                <WorkflowRow
                  key={wf.id}
                  workflow={wf}
                  expanded={wf.id === selectedId}
                  onToggle={() =>
                    setSelectedId((cur) => (cur === wf.id ? null : wf.id))
                  }
                  onDelete={() => handleDeleteWorkflow(wf)}
                  deleting={deleteWorkflow.isPending}
                />
              ))}
            </ul>
          )}

          {/* Form tạo workflow */}
          {adding && (
            <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="wf-name"
                    className="mb-1 block text-xs font-medium text-muted"
                  >
                    Tên workflow
                  </label>
                  <Input
                    id="wf-name"
                    value={name}
                    autoFocus
                    placeholder="VD: Quy trình phát triển"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitAdd();
                      if (e.key === 'Escape') resetAdd();
                    }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="wf-desc"
                    className="mb-1 block text-xs font-medium text-muted"
                  >
                    Mô tả (tuỳ chọn)
                  </label>
                  <Input
                    id="wf-desc"
                    value={description}
                    placeholder="Mô tả ngắn gọn quy trình"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div>
                  <label
                    htmlFor="wf-project"
                    className="mb-1 block text-xs font-medium text-muted"
                  >
                    Project ID (tuỳ chọn)
                  </label>
                  <Input
                    id="wf-project"
                    value={projectId}
                    placeholder="Để trống = áp dụng cho cả workspace"
                    onChange={(e) => setProjectId(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-faint">
                    Để trống nếu workflow dùng chung cho cả workspace.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={submitAdd} loading={createWorkflow.isPending}>
                    Tạo
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={resetAdd}
                    disabled={createWorkflow.isPending}
                  >
                    Huỷ
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {selected && <WorkflowDetail workflow={selected} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Một dòng workflow trong danh sách                                   */
/* ------------------------------------------------------------------ */

function WorkflowRow({
  workflow,
  expanded,
  onToggle,
  onDelete,
  deleting,
}: {
  workflow: Workflow;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors',
        expanded ? 'border-primary bg-primary-subtle' : 'border-border bg-surface hover:bg-surface-2',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 text-faint transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        <span className="truncate text-sm font-medium text-ink">{workflow.name}</span>
        {workflow.isDefault && (
          <Badge className="bg-primary-subtle text-primary">Mặc định</Badge>
        )}
        {workflow.isTemplate && (
          <Badge className="bg-surface-2 text-muted">Template</Badge>
        )}
      </button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        loading={deleting}
        title="Xoá workflow"
        className="text-muted hover:text-danger"
      >
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Xoá workflow {workflow.name}</span>
      </Button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Chi tiết workflow đã chọn                                           */
/* ------------------------------------------------------------------ */

function WorkflowDetail({ workflow }: { workflow: Workflow }) {
  const [view, setView] = useState<'graph' | 'list'>('graph');
  return (
    <div className="mt-6 space-y-4">
      <div
        role="tablist"
        aria-label="Kiểu xem workflow"
        className="inline-flex rounded-md border border-border bg-surface-2 p-0.5"
      >
        {(
          [
            ['graph', 'Sơ đồ'],
            ['list', 'Danh sách'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={cn(
              'rounded-[5px] px-3 py-1 text-sm font-medium transition-colors',
              view === v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'graph' ? (
        <WorkflowGraph workflow={workflow} />
      ) : (
        <div className="space-y-6">
          <StatusSection workflow={workflow} />
          <TransitionSection workflow={workflow} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trạng thái (Statuses)                                              */
/* ------------------------------------------------------------------ */

function StatusSection({ workflow }: { workflow: Workflow }) {
  const addStatus = useAddStatus();
  const updateStatus = useUpdateStatus();
  const deleteStatus = useDeleteStatus();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StatusCategory>('TODO');
  const [color, setColor] = useState(DEFAULT_STATUS_COLOR);

  const statuses = useMemo(
    () => workflow.statuses.slice().sort((a, b) => a.order - b.order),
    [workflow.statuses],
  );

  function resetAdd() {
    setName('');
    setCategory('TODO');
    setColor(DEFAULT_STATUS_COLOR);
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên trạng thái.');
      return;
    }
    addStatus.mutate(
      { workflowId: workflow.id, input: { name: trimmed, category, color } },
      {
        onSuccess: resetAdd,
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function setInitial(status: WorkflowStatus) {
    updateStatus.mutate(
      { id: status.id, patch: { isInitial: true } },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function handleDelete(status: WorkflowStatus) {
    if (
      !window.confirm(`Xoá trạng thái "${status.name}"? Hành động này không thể hoàn tác.`)
    )
      return;
    deleteStatus.mutate(status.id, {
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <CircleDot className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Trạng thái</h2>
          <p className="mt-0.5 text-sm text-muted">
            Các trạng thái issue có thể có trong workflow này.
          </p>
        </div>
      </div>

      <div className="p-5">
        {statuses.length === 0 && !adding ? (
          <EmptyState
            icon={<CircleDot className="h-6 w-6" />}
            title="Chưa có trạng thái nào"
            description="Thêm trạng thái đầu tiên cho workflow này."
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Thêm trạng thái
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {statuses.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-border"
                  style={{ background: s.color ?? CATEGORY_VAR[s.category] }}
                  aria-hidden
                />
                <span className="truncate text-sm font-medium text-ink">{s.name}</span>
                <Badge
                  className="bg-surface-2 text-muted"
                  dotColor={CATEGORY_VAR[s.category]}
                >
                  {CATEGORY_LABEL[s.category]}
                </Badge>
                {s.isInitial && (
                  <Badge className="bg-primary-subtle text-primary">
                    <Flag className="h-3 w-3" />
                    Khởi đầu
                  </Badge>
                )}
                <span className="font-mono text-xs text-faint">#{s.order}</span>

                <div className="ml-auto flex items-center gap-1">
                  {!s.isInitial && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setInitial(s)}
                      loading={updateStatus.isPending}
                      title="Đặt làm trạng thái khởi đầu"
                    >
                      <Flag className="h-4 w-4" />
                      Đặt khởi đầu
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(s)}
                    title="Xoá trạng thái"
                    className="text-muted hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Xoá trạng thái {s.name}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Form thêm trạng thái */}
        {adding ? (
          <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <label
                  htmlFor="st-name"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  Tên
                </label>
                <Input
                  id="st-name"
                  value={name}
                  autoFocus
                  placeholder="VD: Đang xem xét"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitAdd();
                    if (e.key === 'Escape') resetAdd();
                  }}
                />
              </div>
              <div className="w-40">
                <label
                  htmlFor="st-category"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  Phân loại
                </label>
                <select
                  id="st-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as StatusCategory)}
                  className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-ink focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="st-color"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  Màu
                </label>
                <input
                  id="st-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border border-border bg-bg p-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={submitAdd} loading={addStatus.isPending}>
                  Lưu
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetAdd}
                  disabled={addStatus.isPending}
                >
                  Huỷ
                </Button>
              </div>
            </div>
          </div>
        ) : (
          statuses.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-4 w-4" />
              Thêm trạng thái
            </Button>
          )
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Chuyển trạng thái (Transitions)                                    */
/* ------------------------------------------------------------------ */

const ANY_FROM = '__ANY__';

function TransitionSection({ workflow }: { workflow: Workflow }) {
  const addTransition = useAddTransition();
  const deleteTransition = useDeleteTransition();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [fromStatusId, setFromStatusId] = useState<string>(ANY_FROM);
  const [toStatusId, setToStatusId] = useState<string>('');

  const statuses = useMemo(
    () => workflow.statuses.slice().sort((a, b) => a.order - b.order),
    [workflow.statuses],
  );

  const statusName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of workflow.statuses) map.set(s.id, s.name);
    return (id: string | null) => (id == null ? '(bất kỳ)' : map.get(id) ?? '(không rõ)');
  }, [workflow.statuses]);

  const transitions = useMemo(
    () => workflow.transitions.slice().sort((a, b) => a.order - b.order),
    [workflow.transitions],
  );

  function resetAdd() {
    setName('');
    setFromStatusId(ANY_FROM);
    setToStatusId('');
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên bước chuyển.');
      return;
    }
    if (!toStatusId) {
      toast.error('Vui lòng chọn trạng thái đích.');
      return;
    }
    addTransition.mutate(
      {
        workflowId: workflow.id,
        input: {
          name: trimmed,
          fromStatusId: fromStatusId === ANY_FROM ? null : fromStatusId,
          toStatusId,
        },
      },
      {
        onSuccess: resetAdd,
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function handleDelete(t: WorkflowTransition) {
    if (
      !window.confirm(`Xoá bước chuyển "${t.name}"? Hành động này không thể hoàn tác.`)
    )
      return;
    deleteTransition.mutate(t.id, {
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  const noStatuses = statuses.length === 0;

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <ArrowRight className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Chuyển trạng thái</h2>
          <p className="mt-0.5 text-sm text-muted">
            Các bước cho phép issue chuyển từ trạng thái này sang trạng thái khác.
          </p>
        </div>
      </div>

      <div className="p-5">
        {transitions.length === 0 && !adding ? (
          <EmptyState
            icon={<ArrowRight className="h-6 w-6" />}
            title="Chưa có bước chuyển nào"
            description={
              noStatuses
                ? 'Hãy thêm trạng thái trước khi tạo bước chuyển.'
                : 'Thêm bước chuyển đầu tiên cho workflow này.'
            }
            action={
              !noStatuses && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" />
                  Thêm bước chuyển
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {transitions.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <Circle className="h-3 w-3 shrink-0 text-faint" aria-hidden />
                <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="font-mono">{statusName(t.fromStatusId)}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-faint" aria-hidden />
                  <span className="font-mono">{statusName(t.toStatusId)}</span>
                </span>

                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(t)}
                    title="Xoá bước chuyển"
                    className="text-muted hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Xoá bước chuyển {t.name}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Form thêm bước chuyển */}
        {adding ? (
          <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <label
                  htmlFor="tr-name"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  Tên
                </label>
                <Input
                  id="tr-name"
                  value={name}
                  autoFocus
                  placeholder="VD: Bắt đầu làm"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitAdd();
                    if (e.key === 'Escape') resetAdd();
                  }}
                />
              </div>
              <div className="w-40">
                <label
                  htmlFor="tr-from"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  Từ
                </label>
                <SearchSelect
                  id="tr-from"
                  value={fromStatusId}
                  onChange={setFromStatusId}
                  options={[
                    { value: ANY_FROM, label: '(bất kỳ)' },
                    ...statuses.map((s) => ({
                      value: s.id,
                      label: s.name,
                      color: s.color ?? CATEGORY_VAR[s.category],
                    })),
                  ]}
                  className="w-full"
                />
              </div>
              <div className="w-40">
                <label
                  htmlFor="tr-to"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  Đến
                </label>
                <SearchSelect
                  id="tr-to"
                  value={toStatusId}
                  onChange={setToStatusId}
                  options={statuses.map((s) => ({
                    value: s.id,
                    label: s.name,
                    color: s.color ?? CATEGORY_VAR[s.category],
                  }))}
                  placeholder="Chọn trạng thái…"
                  className="w-full"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={submitAdd} loading={addTransition.isPending}>
                  Lưu
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetAdd}
                  disabled={addTransition.isPending}
                >
                  Huỷ
                </Button>
              </div>
            </div>
          </div>
        ) : (
          !noStatuses &&
          transitions.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-4 w-4" />
              Thêm bước chuyển
            </Button>
          )
        )}
      </div>
    </section>
  );
}
