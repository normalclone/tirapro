import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GitBranch, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/SectionCard';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useConfirm } from '@/components/ui/useConfirm';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { ReadOnlyNote } from '@/components/ui/NoAccess';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { WorkflowEditDialog } from './WorkflowEditDialog';
import { useWorkflows, useCreateWorkflow, useDeleteWorkflow, type Workflow } from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SETTINGS_LABELS } from '@/lib/navLabels';
import { useProjects } from '@/features/projects/api';

/* ------------------------------------------------------------------ */
/* Hằng số phân loại trạng thái                                       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Trang chính                                                         */
/* ------------------------------------------------------------------ */

export function WorkflowSettingsPage() {
  const workflowsQuery = useWorkflows();
  const { data } = workflowsQuery;
  const createWorkflow = useCreateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const confirm = useConfirm();
  // Ghi quy trình cần `workspace:admin` (API) — người khác xem được, không thấy nút ghi.
  const canManage = useAuth((s) => s.can('workspace:admin'));

  // Hộp thoại sửa mở theo `?workflow=<id>` → tải lại trang vẫn mở đúng quy trình, Back/Esc đóng.
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('workflow');
  const setSelectedId = (id: string | null) =>
    setParams(
      (cur) => {
        const next = new URLSearchParams(cur);
        if (id) next.set('workflow', id);
        else next.delete('workflow');
        return next;
      },
      { replace: true },
    );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const { data: projects } = useProjects();

  const workflows = data ?? [];
  const groups = useMemo(() => groupWorkflows(data ?? []), [data]);
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
      toast.error('Vui lòng nhập tên quy trình.');
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

  async function handleDeleteWorkflow(wf: Workflow) {
    const ok = await confirm({
      title: `Xoá quy trình "${wf.name}"?`,
      description: wf.isTemplate
        ? 'Mẫu chỉ dùng để tham khảo; dự án đã tạo không bị ảnh hưởng. Hành động này không thể hoàn tác.'
        : 'Quy trình và các trạng thái, chuyển tiếp của nó sẽ bị xoá. Hành động này không thể hoàn tác.',
      destructive: true,
      requireText: wf.name,
    });
    if (!ok) return;
    deleteWorkflow.mutate(wf.id, {
      onSuccess: () => {
        if (selectedId === wf.id) setSelectedId(null);
      },
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <PageFrame size="lg">
      <PageHeader
        title={SETTINGS_LABELS.workflows}
        description="Các trạng thái của một công việc và những bước chuyển được phép giữa chúng."
      />
      {!canManage && <ReadOnlyNote />}

      <SectionCard
        icon={<GitBranch className="h-4 w-4" />}
        title="Danh sách quy trình"
        description="Chọn một quy trình để xem và chỉnh sửa chi tiết."
        actions={
          canManage && !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Tạo quy trình
            </Button>
          ) : undefined
        }
      >
        <QueryBoundary
          query={workflowsQuery}
          skeleton={
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          }
          empty={() => workflows.length === 0 && !adding}
          emptyState={
            <EmptyState
              icon={<GitBranch className="h-6 w-6" />}
              title="Chưa có quy trình nào"
              description={
                canManage
                  ? 'Quy trình là chuỗi trạng thái mà mỗi công việc đi qua, từ lúc mở đến lúc xong. Tạo quy trình đầu tiên để bắt đầu.'
                  : 'Chưa có quy trình nào. Nhờ quản trị chung tạo giúp.'
              }
              action={
                canManage ? (
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" />
                    Tạo quy trình
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {() => (
            <div className="space-y-5">
              {groups.map((g) => (
                <section key={g.id} aria-labelledby={`wf-group-${g.id}`}>
                  <h3 id={`wf-group-${g.id}`} className="mb-2 text-sm font-medium text-muted">
                    {g.title} <span className="font-normal text-faint">({g.items.length})</span>
                  </h3>
                  <ul className="space-y-2">
                    {g.items.map((wf) => (
                      <WorkflowRow
                        key={wf.id}
                        workflow={wf}
                        canManage={canManage}
                        onOpen={() => setSelectedId(wf.id)}
                        onDelete={() => void handleDeleteWorkflow(wf)}
                        deleting={deleteWorkflow.isPending}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </QueryBoundary>

        {/* Form tạo workflow */}
        {canManage && adding && (
          <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
            <div className="space-y-3">
              <div>
                <label htmlFor="wf-name" className="mb-1 block text-xs font-medium text-muted">
                  Tên quy trình
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
                <label htmlFor="wf-desc" className="mb-1 block text-xs font-medium text-muted">
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
                <label htmlFor="wf-project" className="mb-1 block text-xs font-medium text-muted">
                  Dự án (tuỳ chọn)
                </label>
                <SearchSelect
                  id="wf-project"
                  value={projectId}
                  onChange={setProjectId}
                  options={[
                    { value: '', label: 'Toàn không gian làm việc' },
                    ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
                  ]}
                  searchPlaceholder="Tìm dự án…"
                  className="w-full"
                />
                <p className="mt-1 text-xs text-faint">
                  Chọn “Toàn không gian làm việc” nếu quy trình dùng chung cho mọi dự án.
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
      </SectionCard>

      <WorkflowEditDialog workflow={selected} onClose={() => setSelectedId(null)} />
    </PageFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Nhóm danh sách: mẫu có sẵn / quy trình của dự án / còn lại          */
/* ------------------------------------------------------------------ */

export function groupWorkflows(workflows: Workflow[]) {
  const groups = [
    { id: 'templates', title: 'Mẫu có sẵn', items: workflows.filter((w) => w.isTemplate) },
    {
      id: 'projects',
      title: 'Quy trình của dự án',
      items: workflows.filter((w) => !w.isTemplate && w.projectId !== null),
    },
    {
      id: 'others',
      title: 'Quy trình dùng chung',
      items: workflows.filter((w) => !w.isTemplate && w.projectId === null),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/* ------------------------------------------------------------------ */
/* Một dòng workflow trong danh sách                                   */
/* ------------------------------------------------------------------ */

const MAX_USED_BY_SHOWN = 3;

export function UsedByLine({
  usedBy,
  hiddenCount = 0,
}: {
  usedBy: NonNullable<Workflow['usedBy']>;
  /** Số dự án người xem KHÔNG xem được (riêng tư; hoặc công khai khi chỉ thấy dự án mình là thành viên) — chỉ hiện số, không lộ khoá/tên. */
  hiddenCount?: number;
}) {
  const shown = usedBy.slice(0, MAX_USED_BY_SHOWN);
  const rest = usedBy.length - shown.length;
  return (
    <p className="mt-1 text-xs text-muted">
      {usedBy.length === 0 ? 'Đang dùng bởi' : 'Dùng bởi:'}{' '}
      {shown.map((p, i) => (
        <span key={p.id}>
          {i > 0 && ', '}
          {p.deleted ? (
            <span>
              {p.key} · {p.name} (đã xoá)
            </span>
          ) : (
            <Link
              to={`/p/${p.key}/config`}
              className="text-primary hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {p.key} · {p.name}
            </Link>
          )}
        </span>
      ))}
      {rest > 0 && <span className="text-faint"> +{rest}</span>}
      {hiddenCount > 0 && (
        <span className={usedBy.length > 0 ? 'text-faint' : undefined}>
          {usedBy.length > 0 ? ' · ' : ''}
          {usedBy.length > 0 ? '+' : ''}
          {hiddenCount} dự án bạn không xem được
        </span>
      )}
    </p>
  );
}

function WorkflowRow({
  workflow,
  canManage,
  onOpen,
  onDelete,
  deleting,
}: {
  workflow: Workflow;
  canManage: boolean;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const usedBy = workflow.usedBy ?? [];
  const hiddenCount = workflow.hiddenCount ?? 0;
  const inUse = usedBy.length > 0 || hiddenCount > 0;
  return (
    <li className="rounded-md border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpen}
          data-workflow-row={workflow.id}
          aria-haspopup="dialog"
          title={canManage ? 'Xem và sửa quy trình' : 'Xem quy trình'}
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <span className="truncate text-sm font-medium text-ink">{workflow.name}</span>
          {workflow.isDefault && <Badge className="bg-primary-subtle text-primary">Mặc định</Badge>}
          {workflow.isTemplate && <Badge className="bg-surface-2 text-muted">Mẫu</Badge>}
        </button>
        {!canManage ? null : inUse ? (
          <span
            className="shrink-0 text-xs text-faint"
            title="Dự án đang dùng quy trình này (kể cả dự án đã xoá) vẫn giữ nó nên không xoá được — chưa có cách đổi quy trình của dự án."
          >
            Đang dùng — không xoá được
          </span>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            loading={deleting}
            title="Xoá quy trình"
            className="text-muted hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Xoá quy trình {workflow.name}</span>
          </Button>
        )}
      </div>
      {inUse && <UsedByLine usedBy={usedBy} hiddenCount={hiddenCount} />}
    </li>
  );
}
