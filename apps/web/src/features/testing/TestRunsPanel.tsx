import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bug, CheckCircle2, ClipboardList, Play, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Field, ModalShell, textareaClass } from './ModalShell';
import {
  useAddCasesToRun, useCreateBugFromExecution, useCreateTestRun, useDeleteTestRun,
  useRemoveCaseFromRun, useSetExecutionResult, useTestCases, useTestRun, useTestRuns,
  useUpdateTestRun, type TestExecutionDto, type TestProgress, type TestResult, type TestRunDto,
} from './api';

/** Nhãn tiếng Việt + màu token cho từng kết quả kiểm thử. */
export const RESULT_META: Record<TestResult, { label: string; short: string; color: string; text: string; bg: string }> = {
  PASSED: { label: 'Đạt', short: 'Đạt', color: 'var(--success)', text: 'text-success', bg: 'bg-success/10' },
  FAILED: { label: 'Không đạt', short: 'Không đạt', color: 'var(--danger)', text: 'text-danger', bg: 'bg-danger/10' },
  BLOCKED: { label: 'Bị chặn', short: 'Bị chặn', color: 'var(--warning)', text: 'text-warning', bg: 'bg-warning/10' },
  SKIPPED: { label: 'Bỏ qua', short: 'Bỏ qua', color: 'var(--muted)', text: 'text-muted', bg: 'bg-surface-3' },
  UNTESTED: { label: 'Chưa chạy', short: 'Chưa chạy', color: 'var(--border-strong)', text: 'text-faint', bg: 'bg-surface-2' },
};

const RESULT_ORDER: TestResult[] = ['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', 'UNTESTED'];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Thanh tiến độ 5 đoạn theo kết quả — nhìn một lượt biết đợt chạy đang ở đâu. */
function ProgressBar({ progress }: { progress: TestProgress }) {
  const done = progress.total - progress.UNTESTED;
  const pct = progress.total ? Math.round((done / progress.total) * 100) : 0;
  const title = RESULT_ORDER.map((r) => `${RESULT_META[r].label} ${progress[r]}`).join(' · ');

  return (
    <div className="space-y-1.5">
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Tiến độ chạy: ${pct}%`}
        title={title}
      >
        {RESULT_ORDER.map((r) =>
          progress[r] > 0 ? <span key={r} style={{ flexGrow: progress[r], background: RESULT_META[r].color }} /> : null,
        )}
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {RESULT_ORDER.map((r) => (
          <li key={r} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RESULT_META[r].color }} aria-hidden />
            {RESULT_META[r].label} <span className="font-medium text-ink">{progress[r]}</span>
          </li>
        ))}
        <li className="text-faint">Tổng {progress.total}</li>
      </ul>
    </div>
  );
}

/** Tab "Đợt chạy": danh sách đợt (kèm tiến độ) hoặc chi tiết một đợt. */
export function TestRunsPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  if (openRunId) {
    return <RunDetail projectId={projectId} runId={openRunId} canManage={canManage} onBack={() => setOpenRunId(null)} />;
  }
  return <RunList projectId={projectId} canManage={canManage} onOpen={setOpenRunId} />;
}

function RunList({
  projectId,
  canManage,
  onOpen,
}: {
  projectId: string;
  canManage: boolean;
  onOpen: (runId: string) => void;
}) {
  const { data: runs, isLoading, isError, error, refetch } = useTestRuns(projectId);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Mỗi đợt chạy gom một tập ca kiểm thử để ghi kết quả cho một lần kiểm thử (bản phát hành, sprint…).
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Tạo đợt chạy
          </Button>
        )}
      </div>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !runs || runs.length === 0 ? (
        <EmptyState
          icon={<Play className="h-6 w-6" />}
          title="Chưa có đợt chạy nào"
          description="Tạo đợt chạy, chọn các ca kiểm thử cần chạy rồi ghi kết quả cho từng ca."
          action={canManage ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Tạo đợt chạy</Button> : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {runs.map((run) => <RunCard key={run.id} run={run} onOpen={() => onOpen(run.id)} />)}
        </ul>
      )}

      <CreateRunModal
        open={createOpen}
        projectId={projectId}
        onClose={() => setCreateOpen(false)}
        onCreated={(runId) => { setCreateOpen(false); onOpen(runId); }}
      />
    </section>
  );
}

function RunCard({ run, onOpen }: { run: TestRunDto; onOpen: () => void }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="rounded text-left text-base font-semibold text-ink-strong transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {run.name}
          </button>
          <p className="mt-0.5 text-xs text-faint">
            Bắt đầu {formatDate(run.startedAt)}
            {run.finishedAt ? ` · Kết thúc ${formatDate(run.finishedAt)}` : ' · Đang chạy'}
          </p>
          {run.description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{run.description}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={onOpen}>Mở đợt chạy</Button>
      </div>
      <div className="mt-3">
        <ProgressBar progress={run.progress} />
      </div>
    </li>
  );
}

function RunDetail({
  projectId,
  runId,
  canManage,
  onBack,
}: {
  projectId: string;
  runId: string;
  canManage: boolean;
  onBack: () => void;
}) {
  const { data: run, isLoading, isError, error, refetch } = useTestRun(projectId, runId);
  const updateRun = useUpdateTestRun(projectId);
  const deleteRun = useDeleteTestRun(projectId);
  const [addOpen, setAddOpen] = useState(false);

  async function toggleFinished() {
    if (!run) return;
    try {
      await updateRun.mutateAsync({ runId, finished: !run.finishedAt });
      toast.success(run.finishedAt ? 'Đã mở lại đợt chạy' : 'Đã kết thúc đợt chạy');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function remove() {
    if (!run) return;
    if (!window.confirm(`Xóa đợt chạy "${run.name}"? Toàn bộ kết quả trong đợt sẽ mất.`)) return;
    try {
      await deleteRun.mutateAsync(runId);
      toast.success('Đã xóa đợt chạy');
      onBack();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <section className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> Tất cả đợt chạy
      </Button>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isLoading || !run ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-ink-strong">{run.name}</h2>
                <p className="mt-0.5 text-xs text-faint">
                  Bắt đầu {formatDate(run.startedAt)}
                  {run.finishedAt ? ` · Kết thúc ${formatDate(run.finishedAt)}` : ' · Đang chạy'}
                </p>
                {run.description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{run.description}</p>}
              </div>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
                    <Plus className="h-4 w-4" /> Thêm ca kiểm thử
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void toggleFinished()} loading={updateRun.isPending}>
                    {run.finishedAt ? <><RotateCcw className="h-4 w-4" /> Mở lại</> : <><CheckCircle2 className="h-4 w-4" /> Kết thúc</>}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted hover:text-danger"
                    title="Xóa đợt chạy"
                    aria-label="Xóa đợt chạy"
                    onClick={() => void remove()}
                    loading={deleteRun.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-3">
              <ProgressBar progress={run.progress} />
            </div>
          </div>

          {run.executions.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title="Đợt chạy chưa có ca kiểm thử"
              description="Thêm ca kiểm thử vào đợt để bắt đầu ghi kết quả."
              action={canManage ? <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Thêm ca kiểm thử</Button> : undefined}
            />
          ) : (
            <ul className="space-y-2">
              {run.executions.map((e) => (
                <ExecutionRow key={e.id} projectId={projectId} runId={runId} execution={e} canManage={canManage} />
              ))}
            </ul>
          )}

          <AddCasesModal open={addOpen} projectId={projectId} runId={runId} run={run} onClose={() => setAddOpen(false)} />
        </>
      )}
    </section>
  );
}

function ExecutionRow({
  projectId,
  runId,
  execution,
  canManage,
}: {
  projectId: string;
  runId: string;
  execution: TestExecutionDto;
  canManage: boolean;
}) {
  const setResult = useSetExecutionResult(projectId, runId);
  const createBug = useCreateBugFromExecution(projectId, runId);
  const removeCase = useRemoveCaseFromRun(projectId);
  const [note, setNote] = useState(execution.note ?? '');

  useEffect(() => { setNote(execution.note ?? ''); }, [execution.note]);

  const meta = RESULT_META[execution.result];

  function pick(result: TestResult) {
    if (!canManage || result === execution.result) return;
    setResult.mutate(
      { caseId: execution.testCase.id, result, note: note.trim() || null },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function commitNote() {
    const next = note.trim();
    if (!canManage || next === (execution.note ?? '')) return;
    setResult.mutate(
      { caseId: execution.testCase.id, result: execution.result, note: next || null },
      {
        onError: (e) => toast.error(apiErrorMessage(e)),
        onSuccess: () => toast.success('Đã lưu ghi chú', { duration: 1800 }),
      },
    );
  }

  async function makeBug() {
    try {
      await createBug.mutateAsync({ caseId: execution.testCase.id });
      toast.success('Đã tạo bug từ ca kiểm thử');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function detach() {
    if (!window.confirm(`Gỡ ${execution.testCase.key} khỏi đợt chạy?`)) return;
    try {
      await removeCase.mutateAsync({ runId, caseId: execution.testCase.id });
      toast.success('Đã gỡ ca kiểm thử khỏi đợt chạy');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[14rem] flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted">{execution.testCase.key}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', meta.bg, meta.text)}>{meta.label}</span>
            {execution.testCase.folder && <span className="truncate text-xs text-faint">{execution.testCase.folder}</span>}
          </div>
          <p className="mt-0.5 text-sm font-medium text-ink">{execution.testCase.title}</p>
          {execution.executedBy && execution.executedAt && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-faint">
              <Avatar name={execution.executedBy.displayName} src={execution.executedBy.avatarUrl} size={16} />
              {execution.executedBy.displayName} · {formatDate(execution.executedAt)}
            </p>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:min-w-[20rem]">
          <div className="flex flex-wrap gap-1" role="group" aria-label={`Kết quả cho ${execution.testCase.key}`}>
            {RESULT_ORDER.map((r) => {
              const active = execution.result === r;
              const rm = RESULT_META[r];
              return (
                <button
                  key={r}
                  type="button"
                  disabled={!canManage}
                  aria-pressed={active}
                  onClick={() => pick(r)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    active ? cn(rm.bg, rm.text, 'border-transparent') : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
                    !canManage && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {rm.short}
                </button>
              );
            })}
          </div>

          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            disabled={!canManage}
            maxLength={5000}
            placeholder="Ghi chú kết quả…"
            aria-label={`Ghi chú cho ${execution.testCase.key}`}
            className="h-8"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {execution.bugIssue ? (
            <Link
              to={`/issue/${execution.bugIssue.key}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              title={execution.bugIssue.summary}
            >
              <Bug className="h-3.5 w-3.5 text-danger" aria-hidden />
              <span className="font-mono">{execution.bugIssue.key}</span>
            </Link>
          ) : (
            canManage && execution.result === 'FAILED' && (
              <Button size="sm" variant="secondary" onClick={() => void makeBug()} loading={createBug.isPending}>
                <Bug className="h-4 w-4" /> Tạo bug
              </Button>
            )
          )}
          {canManage && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted hover:text-danger"
              title="Gỡ khỏi đợt chạy"
              aria-label={`Gỡ ${execution.testCase.key} khỏi đợt chạy`}
              onClick={() => void detach()}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Danh sách ca kiểm thử có ô tìm + chọn nhiều (dùng khi tạo đợt chạy / thêm ca vào đợt). */
function CasePicker({
  projectId,
  excludeIds,
  selected,
  onChange,
}: {
  projectId: string;
  excludeIds?: Set<string>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const { data: cases, isLoading } = useTestCases(projectId);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (cases ?? [])
      .filter((c) => !excludeIds?.has(c.id))
      .filter((c) => !query || c.title.toLowerCase().includes(query) || c.key.toLowerCase().includes(query));
  }, [cases, excludeIds, q]);

  const allSelected = list.length > 0 && list.every((c) => selected.includes(c.id));

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  function toggleAll() {
    if (allSelected) onChange(selected.filter((id) => !list.some((c) => c.id === id)));
    else onChange([...new Set([...selected, ...list.map((c) => c.id)])]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm ca kiểm thử…" className="h-8 pl-8" aria-label="Tìm ca kiểm thử" />
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={toggleAll} disabled={list.length === 0}>
          {allSelected ? 'Bỏ chọn hết' : 'Chọn hết'}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted">
          Không có ca kiểm thử phù hợp.
        </p>
      ) : (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {list.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                  className="h-4 w-4 shrink-0 rounded border-border accent-[var(--primary)]"
                />
                <span className="font-mono text-xs text-muted">{c.key}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{c.title}</span>
                {c.folder && <span className="shrink-0 text-xs text-faint">{c.folder}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-faint">Đã chọn {selected.length} ca kiểm thử.</p>
    </div>
  );
}

function CreateRunModal({
  open,
  projectId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (runId: string) => void;
}) {
  const create = useCreateTestRun(projectId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [caseIds, setCaseIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const today = new Date().toLocaleDateString('vi-VN');
    setName(`Đợt chạy ${today}`);
    setDescription('');
    setCaseIds([]);
  }, [open]);

  const canSave = name.trim().length > 0 && !create.isPending;

  async function save() {
    if (!canSave) return;
    try {
      const run = await create.mutateAsync({ name: name.trim(), description: description.trim() || null, caseIds });
      toast.success('Đã tạo đợt chạy');
      onCreated(run.id);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <ModalShell
      open={open}
      size="lg"
      title="Tạo đợt chạy"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={create.isPending} disabled={!canSave}>Tạo đợt chạy</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên đợt chạy" htmlFor="run-name">
          <Input id="run-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} autoFocus placeholder="VD: Kiểm thử hồi quy bản 1.4" />
        </Field>
        <Field label="Mô tả" hint="(tùy chọn)" htmlFor="run-desc">
          <textarea
            id="run-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Phạm vi, môi trường, phiên bản…"
            className={textareaClass}
          />
        </Field>
        <Field label="Ca kiểm thử" hint="(có thể thêm sau)">
          <CasePicker projectId={projectId} selected={caseIds} onChange={setCaseIds} />
        </Field>
      </div>
    </ModalShell>
  );
}

function AddCasesModal({
  open,
  projectId,
  runId,
  run,
  onClose,
}: {
  open: boolean;
  projectId: string;
  runId: string;
  run: { executions: TestExecutionDto[] };
  onClose: () => void;
}) {
  const add = useAddCasesToRun(projectId);
  const [caseIds, setCaseIds] = useState<string[]>([]);

  useEffect(() => { if (open) setCaseIds([]); }, [open]);

  const existing = useMemo(() => new Set(run.executions.map((e) => e.testCase.id)), [run.executions]);

  async function save() {
    if (caseIds.length === 0) return;
    try {
      const res = await add.mutateAsync({ runId, caseIds });
      toast.success(`Đã thêm ${res.added} ca kiểm thử vào đợt chạy`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <ModalShell
      open={open}
      size="lg"
      title="Thêm ca kiểm thử vào đợt chạy"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={add.isPending} disabled={caseIds.length === 0 || add.isPending}>
            Thêm {caseIds.length > 0 ? `(${caseIds.length})` : ''}
          </Button>
        </>
      }
    >
      <CasePicker projectId={projectId} excludeIds={existing} selected={caseIds} onChange={setCaseIds} />
    </ModalShell>
  );
}
