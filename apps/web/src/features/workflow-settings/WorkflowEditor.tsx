import { useMemo, useState } from 'react';
import { ArrowRight, Circle, CircleDot, Flag, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/SectionCard';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useConfirm } from '@/components/ui/useConfirm';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { apiErrorMessage } from '@/lib/api';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';
import { useAuth } from '@/stores/auth';
import { WorkflowGraph } from './WorkflowGraph';
import { useReportDraft } from './unsavedDrafts';
import {
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

const CATEGORY_VAR: Record<StatusCategory, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

const CATEGORY_OPTIONS: StatusCategory[] = ['TODO', 'IN_PROGRESS', 'DONE'];

const DEFAULT_STATUS_COLOR = '#64748b';

/* ------------------------------------------------------------------ */
/* Chi tiết workflow đã chọn                                           */
/* ------------------------------------------------------------------ */

/** Nội dung hộp thoại sửa quy trình: tab Sơ đồ / Danh sách; lấp đầy chiều cao hộp thoại (sơ đồ co theo khung, canh khung lại khi đổi cỡ). */
export function WorkflowDetail({ workflow }: { workflow: Workflow }) {
  const [view, setView] = useState<'graph' | 'list'>('graph');
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <SegmentedControl
        ariaLabel="Kiểu xem quy trình"
        value={view}
        onChange={setView}
        options={[
          { value: 'graph', label: 'Sơ đồ' },
          { value: 'list', label: 'Danh sách' },
        ]}
        fullWidth={false}
      />

      {view === 'graph' ? (
        <WorkflowGraph workflow={workflow} className="min-h-[320px] flex-1" inDialog />
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
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
  const confirm = useConfirm();
  const canManage = useAuth((s) => s.can('workspace:admin'));

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StatusCategory>('TODO');
  const [color, setColor] = useState(DEFAULT_STATUS_COLOR);
  useReportDraft(adding && name.trim() !== '');

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

  async function handleDelete(status: WorkflowStatus) {
    const ok = await confirm({
      title: `Xoá trạng thái "${status.name}"?`,
      description: 'Hành động này không thể hoàn tác.',
      destructive: true,
    });
    if (!ok) return;
    deleteStatus.mutate(status.id, {
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <SectionCard
      icon={<CircleDot className="h-4 w-4" />}
      title="Trạng thái"
      description="Các trạng thái mà công việc có thể ở, trong quy trình này."
    >
      {statuses.length === 0 && !adding ? (
        <EmptyState
          icon={<CircleDot className="h-6 w-6" />}
          title="Chưa có trạng thái nào"
          description={
            canManage
              ? 'Trạng thái cho biết công việc đang ở bước nào (vd To Do, In Progress, Done). Thêm trạng thái đầu tiên cho quy trình này.'
              : 'Quy trình này chưa có trạng thái nào.'
          }
          action={
            canManage ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Thêm trạng thái
              </Button>
            ) : undefined
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
              <Badge className="bg-surface-2 text-muted" dotColor={CATEGORY_VAR[s.category]}>
                {STATUS_CATEGORY_LABEL[s.category]}
              </Badge>
              {s.isInitial && (
                <Badge className="bg-primary-subtle text-primary">
                  <Flag className="h-3 w-3" />
                  Khởi đầu
                </Badge>
              )}
              <span className="font-mono text-xs text-faint">#{s.order}</span>

              {canManage && (
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
                    onClick={() => void handleDelete(s)}
                    title="Xoá trạng thái"
                    className="text-muted hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Xoá trạng thái {s.name}</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Form thêm trạng thái */}
      {!canManage ? null : adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <label htmlFor="st-name" className="mb-1 block text-xs font-medium text-muted">
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
            <div>
              <span id="st-category-label" className="mb-1 block text-xs font-medium text-muted">
                Phân loại
              </span>
              <SegmentedControl<StatusCategory>
                ariaLabelledby="st-category-label"
                value={category}
                onChange={setCategory}
                options={CATEGORY_OPTIONS.map((c) => ({
                  value: c,
                  label: STATUS_CATEGORY_LABEL[c],
                }))}
              />
            </div>
            <div>
              <label htmlFor="st-color" className="mb-1 block text-xs font-medium text-muted">
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
              <Button size="sm" variant="ghost" onClick={resetAdd} disabled={addStatus.isPending}>
                Huỷ
              </Button>
            </div>
          </div>
        </div>
      ) : (
        statuses.length > 0 && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Thêm trạng thái
          </Button>
        )
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Chuyển trạng thái (Transitions)                                    */
/* ------------------------------------------------------------------ */

const ANY_FROM = '__ANY__';

function TransitionSection({ workflow }: { workflow: Workflow }) {
  const addTransition = useAddTransition();
  const deleteTransition = useDeleteTransition();
  const confirm = useConfirm();
  const canManage = useAuth((s) => s.can('workspace:admin'));

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [fromStatusId, setFromStatusId] = useState<string>(ANY_FROM);
  const [toStatusId, setToStatusId] = useState<string>('');
  useReportDraft(adding && (name.trim() !== '' || toStatusId !== ''));

  const statuses = useMemo(
    () => workflow.statuses.slice().sort((a, b) => a.order - b.order),
    [workflow.statuses],
  );

  const statusName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of workflow.statuses) map.set(s.id, s.name);
    return (id: string | null) => (id == null ? '(bất kỳ)' : (map.get(id) ?? '(không rõ)'));
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

  async function handleDelete(t: WorkflowTransition) {
    const ok = await confirm({
      title: `Xoá bước chuyển "${t.name}"?`,
      description: 'Hành động này không thể hoàn tác.',
      destructive: true,
    });
    if (!ok) return;
    deleteTransition.mutate(t.id, {
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  const noStatuses = statuses.length === 0;

  return (
    <SectionCard
      icon={<ArrowRight className="h-4 w-4" />}
      title="Chuyển trạng thái"
      description="Các bước cho phép công việc chuyển từ trạng thái này sang trạng thái khác."
    >
      {transitions.length === 0 && !adding ? (
        <EmptyState
          icon={<ArrowRight className="h-6 w-6" />}
          title="Chưa có bước chuyển nào"
          description={
            noStatuses
              ? 'Hãy thêm trạng thái trước khi tạo bước chuyển.'
              : 'Bước chuyển quy định công việc được đi từ trạng thái nào sang trạng thái nào. Thêm bước chuyển đầu tiên cho quy trình này.'
          }
          action={
            canManage &&
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

              {canManage && (
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleDelete(t)}
                    title="Xoá bước chuyển"
                    className="text-muted hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Xoá bước chuyển {t.name}</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Form thêm bước chuyển */}
      {!canManage ? null : adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <label htmlFor="tr-name" className="mb-1 block text-xs font-medium text-muted">
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
              <label htmlFor="tr-from" className="mb-1 block text-xs font-medium text-muted">
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
              <label htmlFor="tr-to" className="mb-1 block text-xs font-medium text-muted">
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
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Thêm bước chuyển
          </Button>
        )
      )}
    </SectionCard>
  );
}
