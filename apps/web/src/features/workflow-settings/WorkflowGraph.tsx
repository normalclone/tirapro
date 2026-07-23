import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  MarkerType,
  useEdgesState,
  useNodesState,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/api';
import {
  useAddStatus,
  useAddTransition,
  useDeleteStatus,
  useDeleteTransition,
  type StatusCategory,
  type Workflow,
} from './api';

const ANY_ID = '__any__';

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
const CATEGORY_COL: Record<StatusCategory, number> = { TODO: 1, IN_PROGRESS: 2, DONE: 3 };
const COL_W = 240;
const ROW_H = 108;

type NodeData = {
  label: string;
  isAny?: boolean;
  category?: StatusCategory;
  color?: string | null;
  isInitial?: boolean;
  onDelete?: (id: string) => void;
};

type PosMap = Record<string, { x: number; y: number }>;

function loadPos(workflowId: string): PosMap {
  try {
    return JSON.parse(localStorage.getItem(`tirapro-wf-pos-${workflowId}`) || '{}') as PosMap;
  } catch {
    return {};
  }
}
function savePos(workflowId: string, map: PosMap) {
  try {
    localStorage.setItem(`tirapro-wf-pos-${workflowId}`, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Bố cục tự động: cột theo nhóm trạng thái (Bất kỳ → Cần làm → Đang làm → Hoàn thành). */
function autoLayout(wf: Workflow): PosMap {
  const counts: Record<StatusCategory, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
  const pos: PosMap = { [ANY_ID]: { x: 0, y: 24 } };
  for (const s of [...wf.statuses].sort((a, b) => a.order - b.order)) {
    pos[s.id] = { x: CATEGORY_COL[s.category] * COL_W, y: 24 + counts[s.category] * ROW_H };
    counts[s.category] += 1;
  }
  return pos;
}

function buildNodes(wf: Workflow, saved: PosMap, onDelete: (id: string) => void): Node<NodeData>[] {
  const auto = autoLayout(wf);
  const at = (id: string) => saved[id] ?? auto[id] ?? { x: 0, y: 0 };
  const nodes: Node<NodeData>[] = [
    { id: ANY_ID, type: 'wf', position: at(ANY_ID), data: { label: 'Bất kỳ trạng thái', isAny: true } },
  ];
  for (const s of wf.statuses) {
    nodes.push({
      id: s.id,
      type: 'wf',
      position: at(s.id),
      data: { label: s.name, category: s.category, color: s.color, isInitial: s.isInitial, onDelete },
    });
  }
  return nodes;
}

function buildEdges(wf: Workflow): Edge[] {
  return wf.transitions.map((t) => ({
    id: t.id,
    source: t.fromStatusId ?? ANY_ID,
    target: t.toStatusId,
    label: t.name,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--border-strong)' },
    style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 },
    labelStyle: { fill: 'var(--muted)', fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: 'var(--surface)', fillOpacity: 0.9 },
    labelBgPadding: [4, 2] as [number, number],
  }));
}

/** Node trạng thái (n8n-style): chấm màu theo nhóm, tên, badge khởi tạo, nút xoá. */
function StatusNode({ id, data, selected }: NodeProps<NodeData>) {
  if (data.isAny) {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-border-strong bg-surface-2 px-3 py-2 text-sm text-muted',
          selected && 'ring-2 ring-[var(--ring)]',
        )}
      >
        {data.label}
        <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-faint" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'group relative min-w-[150px] rounded-lg border border-border bg-surface px-3 py-2 shadow-sm',
        selected && 'border-primary ring-2 ring-[var(--ring)]',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-[var(--border-strong)]" />
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: data.color || (data.category ? CATEGORY_VAR[data.category] : 'var(--faint)') }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-strong">{data.label}</span>
        {data.isInitial && (
          <span className="rounded bg-primary-subtle px-1 py-0.5 text-[10px] font-medium text-primary">Khởi tạo</span>
        )}
      </div>
      {data.category && (
        <span className="mt-0.5 block text-[11px] text-faint">{CATEGORY_LABEL[data.category]}</span>
      )}
      <button
        type="button"
        onClick={() => data.onDelete?.(id)}
        title="Xoá trạng thái"
        className="absolute -right-2 -top-2 hidden h-5 w-5 place-items-center rounded-full border border-border bg-surface text-muted shadow-sm hover:text-danger group-hover:grid"
      >
        <Trash2 className="h-3 w-3" aria-hidden />
      </button>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-primary" />
    </div>
  );
}

const nodeTypes = { wf: StatusNode };

/** Canh khung (fitView) sau khi node đã đo kích thước — tránh node nằm ngoài viewport lúc mount. */
function FitView({ dep }: { dep: string }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (initialized) fitView({ padding: 0.2, duration: 0 });
  }, [initialized, dep, fitView]);
  return null;
}

export function WorkflowGraph({ workflow }: { workflow: Workflow }) {
  const addTransition = useAddTransition();
  const deleteTransition = useDeleteTransition();
  const addStatus = useAddStatus();
  const deleteStatus = useDeleteStatus();

  const posRef = useRef<PosMap>(loadPos(workflow.id));
  const statusById = useMemo(
    () => new Map(workflow.statuses.map((s) => [s.id, s])),
    [workflow.statuses],
  );

  const handleDeleteStatus = useCallback(
    (id: string) => {
      const s = statusById.get(id);
      if (!s) return;
      if (!window.confirm(`Xoá trạng thái "${s.name}"? Các chuyển tiếp liên quan cũng sẽ bị xoá.`)) return;
      deleteStatus.mutate(id, { onError: (e) => toast.error(apiErrorMessage(e)) });
    },
    [statusById, deleteStatus],
  );
  // Tham chiếu ổn định cho onDelete để effect dựng node KHÔNG chạy lại mỗi render
  // (object mutation của react-query đổi ref mỗi render → tránh rebuild liên tục khiến reactflow giữ node ẩn).
  const deleteRef = useRef(handleDeleteStatus);
  deleteRef.current = handleDeleteStatus;
  const stableDelete = useCallback((id: string) => deleteRef.current(id), []);

  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Chỉ dựng lại node/edge khi DỮ LIỆU workflow đổi (thêm/xoá) — giữ vị trí đã lưu.
  useEffect(() => {
    posRef.current = loadPos(workflow.id);
    setNodes(buildNodes(workflow, posRef.current, stableDelete));
    setEdges(buildEdges(workflow));
  }, [workflow, stableDelete, setNodes, setEdges]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.target === ANY_ID || c.source === c.target) return;
      const fromId = c.source === ANY_ID ? null : c.source;
      const exists = workflow.transitions.some(
        (t) => (t.fromStatusId ?? null) === fromId && t.toStatusId === c.target,
      );
      if (exists) {
        toast.info('Chuyển tiếp này đã tồn tại.');
        return;
      }
      const fromName = c.source === ANY_ID ? 'Bất kỳ' : statusById.get(c.source)?.name ?? '';
      const toName = statusById.get(c.target)?.name ?? '';
      addTransition.mutate(
        { workflowId: workflow.id, input: { name: `${fromName} → ${toName}`, fromStatusId: fromId, toStatusId: c.target } },
        { onError: (e) => toast.error(apiErrorMessage(e)) },
      );
    },
    [workflow.id, workflow.transitions, statusById, addTransition],
  );

  const onEdgesDelete = useCallback(
    (removed: Edge[]) => {
      for (const e of removed) deleteTransition.mutate(e.id, { onError: (err) => toast.error(apiErrorMessage(err)) });
    },
    [deleteTransition],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      posRef.current = { ...posRef.current, [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) } };
      savePos(workflow.id, posRef.current);
    },
    [workflow.id],
  );

  return (
    <div className="h-[560px] w-full overflow-hidden rounded-lg border border-border bg-surface-2">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeDragStop={onNodeDragStop}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <FitView dep={workflow.id} />
        <Background gap={16} color="var(--border)" />
        <Controls showInteractive={false} className="!border-border !bg-surface !shadow-md" />
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
        <Panel position="bottom-right">
          <p className="rounded-md border border-border bg-surface/90 px-2.5 py-1.5 text-xs text-muted shadow-sm">
            Kéo từ chấm phải của một trạng thái sang trạng thái khác để tạo chuyển tiếp · chọn mũi tên rồi Delete để xoá
          </p>
        </Panel>
      </ReactFlow>
    </div>
  );
}

const CATEGORIES: StatusCategory[] = ['TODO', 'IN_PROGRESS', 'DONE'];

function AddStatusForm({ onAdd, adding }: { onAdd: (name: string, category: StatusCategory) => void; adding: boolean }) {
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
        <label className="mb-1 block text-xs font-medium text-muted">Nhóm</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as StatusCategory)}
          className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-ink focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>
      <Button size="sm" onClick={submit} loading={adding}>
        Thêm
      </Button>
      <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Đóng" className="h-8 w-8">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
