import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  BaseEdge,
  Background,
  EdgeLabelRenderer,
  Controls,
  Handle,
  Panel,
  Position,
  MarkerType,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { AlertTriangle, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useConfirm } from '@/components/ui/useConfirm';
import { cn } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import {
  useAddStatus,
  useAddTransition,
  useDeleteStatus,
  useDeleteTransition,
  type StatusCategory,
  type Workflow,
} from './api';
import {
  layoutWorkflow,
  NODE_H,
  NODE_W,
  type EdgeDir,
  type LayoutEdge,
  type WorkflowLayout,
} from './workflowLayout';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

const CATEGORY_VAR: Record<string, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

type NodeData = {
  label: string;
  category: StatusCategory;
  color?: string | null;
  isInitial?: boolean;
  anyTransitions: { id: string; name: string }[];
  strayTransitions: { id: string; name: string }[];
  onDelete?: (id: string) => void;
  onToggleAny?: (id: string) => void;
  onRemoveAny?: (transitionId: string) => void;
};

type WfEdgeData = { path: string; dir: EdgeDir; label: LayoutEdge['label']; name: string };

function buildNodes(
  wf: Workflow,
  layout: WorkflowLayout,
  handlers: Pick<NodeData, 'onDelete' | 'onToggleAny' | 'onRemoveAny'>,
): Node<NodeData>[] {
  const byId = new Map(wf.statuses.map((s) => [s.id, s]));
  return layout.nodes.map((n) => {
    const s = byId.get(n.id)!;
    return {
      id: n.id,
      type: 'wf',
      position: { x: n.x, y: n.y },
      draggable: false,
      data: {
        label: s.name,
        category: s.category,
        color: s.color,
        isInitial: s.isInitial,
        anyTransitions: n.anyTransitions,
        strayTransitions: n.strayTransitions,
        ...handlers,
      },
    };
  });
}

function buildEdges(layout: WorkflowLayout): Edge<WfEdgeData>[] {
  return layout.edges.map((e) => {
    const color = e.dir === 'back' ? 'var(--faint)' : 'var(--border-strong)';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'wf',
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
      data: { path: e.path, dir: e.dir, label: e.label, name: e.name },
    };
  });
}

/** Cung chuyển tiếp: path tính sẵn từ bố cục (không dùng toạ độ handle); nhãn là chip bấm để chọn. */
function TransitionEdge({ id, data, selected, markerEnd }: EdgeProps<WfEdgeData>) {
  const { setEdges } = useReactFlow();
  if (!data) return null;
  const back = data.dir === 'back';
  const stroke = selected ? 'var(--primary)' : back ? 'var(--faint)' : 'var(--border-strong)';
  return (
    <>
      <BaseEdge
        id={id}
        path={data.path}
        markerEnd={markerEnd}
        interactionWidth={16}
        style={{
          stroke,
          strokeWidth: selected ? 2 : 1.5,
          strokeDasharray: back ? '5 4' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={!!selected}
          aria-label={`${data.name}${back ? ', quay lại' : ''}`}
          onClick={() => setEdges((es) => es.map((e) => ({ ...e, selected: e.id === id })))}
          title={back ? `${data.name} (quay lại)` : data.name}
          style={{
            transform: `translate(-50%, -50%) translate(${data.label.x}px, ${data.label.y}px)`,
            width: data.label.w,
            height: data.label.h,
          }}
          className={cn(
            'nodrag nopan pointer-events-auto absolute truncate rounded border bg-surface px-1.5 text-[11px] font-medium leading-none',
            selected
              ? 'border-primary text-primary'
              : back
                ? 'border-border text-faint'
                : 'border-border text-muted',
          )}
        >
          {data.name}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

/** Node trạng thái: chấm màu theo nhóm, tên, badge khởi tạo, huy hiệu "từ mọi trạng thái", nút xoá. */
function StatusNode({ id, data, selected }: NodeProps<NodeData>) {
  const any = data.anyTransitions;
  const stray = data.strayTransitions;
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={cn(
        'group relative rounded-lg border border-border bg-surface px-3 py-2 shadow-sm',
        selected && 'border-primary ring-2 ring-[var(--ring)]',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-[var(--border-strong)]"
      />
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: data.color || CATEGORY_VAR[data.category] || 'var(--faint)' }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-strong">
          {data.label}
        </span>
        {data.isInitial && (
          <span className="rounded bg-primary-subtle px-1 py-0.5 text-[10px] font-medium text-primary">
            Khởi tạo
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="text-[11px] text-faint">
          {STATUS_CATEGORY_LABEL[data.category] ?? 'Chưa phân nhóm'}
        </span>
        {stray.length > 0 && (
          <span
            title={`Chuyển tiếp không vẽ được (vòng lặp hoặc nguồn không tồn tại): ${stray.map((t) => t.name).join(', ')}`}
            className="inline-flex items-center gap-1 rounded border border-dashed border-danger px-1 text-[10px] text-danger"
          >
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
            {stray.length}
            {data.onRemoveAny && (
              <button
                type="button"
                aria-label="Xoá chuyển tiếp không hợp lệ"
                title="Xoá chuyển tiếp không hợp lệ"
                onClick={() => stray.forEach((t) => data.onRemoveAny?.(t.id))}
                className="nodrag -mr-0.5 rounded hover:text-danger"
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            )}
          </span>
        )}
        {any.length > 0 ? (
          <span
            title={`Chuyển tiếp "${any.map((t) => t.name).join('", "')}": từ mọi trạng thái sang "${data.label}"`}
            className="inline-flex items-center gap-1 rounded border border-dashed border-border-strong px-1 text-[10px] text-muted"
          >
            <RotateCcw className="h-2.5 w-2.5" aria-hidden />
            Từ mọi trạng thái
            {data.onRemoveAny && (
              <button
                type="button"
                aria-label="Bỏ chuyển tiếp từ mọi trạng thái"
                title="Bỏ chuyển tiếp từ mọi trạng thái"
                onClick={() => any.forEach((t) => data.onRemoveAny?.(t.id))}
                className="nodrag -mr-0.5 rounded hover:text-danger"
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            )}
          </span>
        ) : (
          data.onToggleAny && (
            <button
              type="button"
              onClick={() => data.onToggleAny?.(id)}
              title="Cho phép chuyển sang trạng thái này từ mọi trạng thái"
              aria-label="Cho phép chuyển sang trạng thái này từ mọi trạng thái"
              className="nodrag inline-flex items-center gap-1 rounded px-1 text-[10px] text-faint opacity-0 hover:text-primary focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
            </button>
          )
        )}
      </div>
      {data.onDelete && (
        <button
          type="button"
          onClick={() => data.onDelete?.(id)}
          title="Xoá trạng thái"
          aria-label="Xoá trạng thái"
          className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-muted opacity-0 shadow-sm hover:text-danger focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3" aria-hidden />
        </button>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-primary"
      />
    </div>
  );
}

const nodeTypes = { wf: StatusNode };
const edgeTypes = { wf: TransitionEdge };

/** Canh khung theo biên bố cục (gồm cả các cung) khi đổi workflow hoặc dữ liệu. */
function FitView({ bounds, fitKey }: { bounds: WorkflowLayout['bounds']; fitKey: string }) {
  const { fitBounds } = useReactFlow();
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  // Chỉ canh lại khi đổi quy trình hoặc số trạng thái — không reset zoom/pan của người dùng mỗi lần dữ liệu đổi.
  useEffect(() => {
    fitBounds(boundsRef.current, { padding: 0.03, duration: 0 });
  }, [fitKey, fitBounds]);
  return null;
}

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

export function WorkflowGraph({ workflow }: { workflow: Workflow }) {
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
    <div className="h-[560px] w-full overflow-hidden rounded-lg border border-border bg-surface-2">
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
        minZoom={0.05}
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={canManage ? ['Backspace', 'Delete'] : null}
      >
        <FitView bounds={layout.bounds} fitKey={`${workflow.id}:${workflow.statuses.length}`} />
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
              ? 'Kéo từ chấm phải của một trạng thái sang trạng thái khác để tạo chuyển tiếp · chọn mũi tên rồi Delete để xoá'
              : 'Bạn chỉ có quyền xem sơ đồ quy trình.'}
          </p>
        </Panel>
      </ReactFlow>
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
