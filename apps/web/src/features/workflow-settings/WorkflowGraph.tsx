import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Panel,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';
import {
  useAddStatus,
  useAddTransition,
  useDeleteStatus,
  useDeleteTransition,
  type StatusCategory,
  type Workflow,
} from './api';
import { layoutWorkflow } from './workflowLayout';
import { useReportDraft } from './unsavedDrafts';
import {
  AutoFit,
  buildEdges,
  buildNodes,
  edgeTypes,
  HighlightProvider,
  nodeTypes,
  useStatusSelection,
  type NodeData,
  type WfEdgeData,
} from './WorkflowFlowParts';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

function Legend() {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface/90 px-2.5 py-1.5 text-xs text-muted shadow-sm">
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line x1="0" y1="3" x2="22" y2="3" stroke="var(--border-strong)" strokeWidth="2" />
        </svg>
        Chuyển tiếp
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line
            x1="0"
            y1="3"
            x2="22"
            y2="3"
            stroke="var(--faint)"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        </svg>
        Quay lại
      </span>
    </div>
  );
}

interface WorkflowGraphProps {
  workflow: Workflow;
  /** Chiều cao/khung của vùng sơ đồ; mặc định cao cố định 560px (trong hộp thoại truyền `flex-1`). */
  className?: string;
  /** Sơ đồ nằm TRONG hộp thoại sửa: Esc bỏ chọn trạng thái trước (hộp thoại chủ không tính là lớp phủ khác). */
  inDialog?: boolean;
}

export function WorkflowGraph({ workflow, className, inDialog = false }: WorkflowGraphProps) {
  const addTransition = useAddTransition();
  const deleteTransition = useDeleteTransition();
  const addStatus = useAddStatus();
  const deleteStatus = useDeleteStatus();
  const confirm = useConfirm();
  // Chỉ `workspace:admin` được sửa quy trình; người khác chỉ xem sơ đồ.
  const canManage = useAuth((s) => s.can('workspace:admin'));

  const statusById = useMemo(
    () => new Map(workflow.statuses.map((s) => [s.id, s])),
    [workflow.statuses],
  );
  const layout = useMemo(() => layoutWorkflow(workflow), [workflow]);

  const handleDeleteStatus = useCallback(
    async (id: string) => {
      const s = statusById.get(id);
      if (!s) return;
      const ok = await confirm({
        title: `Xoá trạng thái "${s.name}"?`,
        description: 'Các chuyển tiếp liên quan cũng sẽ bị xoá.',
        destructive: true,
      });
      if (!ok) return;
      deleteStatus.mutate(id, { onError: (e) => toast.error(apiErrorMessage(e)) });
    },
    [statusById, deleteStatus, confirm],
  );
  const handleToggleAny = useCallback(
    (id: string) => {
      const s = statusById.get(id);
      if (!s) return;
      addTransition.mutate(
        {
          workflowId: workflow.id,
          input: { name: s.name, fromStatusId: null, toStatusId: id },
        },
        { onError: (e) => toast.error(apiErrorMessage(e)) },
      );
    },
    [workflow.id, statusById, addTransition],
  );
  const handleRemoveAny = useCallback(
    (transitionId: string) =>
      deleteTransition.mutate(transitionId, { onError: (e) => toast.error(apiErrorMessage(e)) }),
    [deleteTransition],
  );
  // Tham chiếu ổn định cho handler (object mutation của react-query đổi ref mỗi render → tránh rebuild node liên tục).
  const ref = useRef({ handleDeleteStatus, handleToggleAny, handleRemoveAny });
  ref.current = { handleDeleteStatus, handleToggleAny, handleRemoveAny };
  const stable = useMemo(
    () => ({
      onDelete: (id: string) => void ref.current.handleDeleteStatus(id),
      onToggleAny: (id: string) => ref.current.handleToggleAny(id),
      onRemoveAny: (id: string) => ref.current.handleRemoveAny(id),
    }),
    [],
  );

  // Chọn một trạng thái → làm nổi đường đi hiện tại/tương lai (không chặn sửa: node/chấm nối/nút xoá vẫn hoạt động như cũ).
  const { selectedId, onNodeClick, onPaneClick } = useStatusSelection(null, inDialog ? 1 : 0);

  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WfEdgeData>([]);

  // Bố cục tự động và ổn định: dựng lại khi DỮ LIỆU workflow đổi.
  useEffect(() => {
    setNodes(buildNodes(workflow, layout, canManage ? stable : {}));
    setEdges((prev) => {
      const sel = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return buildEdges(layout).map((e) => (sel.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [workflow, layout, canManage, stable, setNodes, setEdges]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const exists = workflow.transitions.some(
        (t) => t.fromStatusId === c.source && t.toStatusId === c.target,
      );
      if (exists) {
        toast.info('Chuyển tiếp này đã tồn tại.');
        return;
      }
      const fromName = statusById.get(c.source)?.name ?? '';
      const toName = statusById.get(c.target)?.name ?? '';
      addTransition.mutate(
        {
          workflowId: workflow.id,
          input: { name: `${fromName} → ${toName}`, fromStatusId: c.source, toStatusId: c.target },
        },
        { onError: (e) => toast.error(apiErrorMessage(e)) },
      );
    },
    [workflow.id, workflow.transitions, statusById, addTransition],
  );

  const onEdgesDelete = useCallback(
    (removed: Edge[]) => {
      for (const e of removed)
        deleteTransition.mutate(e.id, { onError: (err) => toast.error(apiErrorMessage(err)) });
    },
    [deleteTransition],
  );

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-lg border border-border bg-surface-2',
        className ?? 'h-[560px]',
      )}
    >
      <HighlightProvider workflow={workflow} selectedId={selectedId}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          nodesConnectable={canManage}
          nodesDraggable={false}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          minZoom={0.3}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={canManage ? ['Backspace', 'Delete'] : null}
        >
          <AutoFit bounds={layout.bounds} fitKey={`${workflow.id}:${workflow.statuses.length}`} />
          <Background gap={16} color="var(--border)" />
          <Controls showInteractive={false} className="!border-border !bg-surface !shadow-md" />
          {canManage && (
            <Panel position="top-left">
              <AddStatusForm
                adding={addStatus.isPending}
                onAdd={(name, category) =>
                  addStatus.mutate(
                    { workflowId: workflow.id, input: { name, category } },
                    { onError: (e) => toast.error(apiErrorMessage(e)) },
                  )
                }
              />
            </Panel>
          )}
          <Panel position="top-right">
            <Legend />
          </Panel>
          <Panel position="bottom-right">
            <p className="rounded-md border border-border bg-surface/90 px-2.5 py-1.5 text-xs text-muted shadow-sm">
              {canManage
                ? 'Kéo từ chấm phải của một trạng thái sang trạng thái khác để tạo chuyển tiếp · chọn mũi tên rồi Delete để xoá · bấm một trạng thái để xem đường đi của nó'
                : 'Bạn chỉ có quyền xem sơ đồ quy trình · bấm một trạng thái để xem đường đi của nó.'}
            </p>
          </Panel>
        </ReactFlow>
      </HighlightProvider>
    </div>
  );
}

const CATEGORIES: StatusCategory[] = ['TODO', 'IN_PROGRESS', 'DONE'];

function AddStatusForm({
  onAdd,
  adding,
}: {
  onAdd: (name: string, category: StatusCategory) => void;
  adding: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StatusCategory>('TODO');
  useReportDraft(open && name.trim() !== '');

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Nhập tên trạng thái.');
      return;
    }
    onAdd(trimmed, category);
    setName('');
    setOpen(false);
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} className="shadow-sm">
        <Plus className="h-4 w-4" />
        Thêm trạng thái
      </Button>
    );
  }
  return (
    <div className="flex items-end gap-2 rounded-lg border border-border bg-surface p-2 shadow-md">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Tên trạng thái</label>
        <Input
          value={name}
          autoFocus
          placeholder="VD: Đang review"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') setOpen(false);
          }}
          className="h-8 w-44 text-sm"
        />
      </div>
      <div>
        <span id="wf-add-category-label" className="mb-1 block text-xs font-medium text-muted">
          Nhóm
        </span>
        <SegmentedControl<StatusCategory>
          ariaLabelledby="wf-add-category-label"
          size="sm"
          fullWidth={false}
          value={category}
          onChange={setCategory}
          options={CATEGORIES.map((c) => ({ value: c, label: STATUS_CATEGORY_LABEL[c] }))}
        />
      </div>
      <Button size="sm" onClick={submit} loading={adding}>
        Thêm
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setOpen(false)}
        aria-label="Đóng"
        className="h-8 w-8"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
