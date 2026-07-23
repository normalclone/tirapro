import { useEffect, useMemo } from 'react';
import ReactFlow, {
  Background, Controls, Handle, Position, MarkerType,
  useNodesInitialized, useReactFlow, type Edge, type Node, type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { X } from 'lucide-react';
import { DelayedSpinner } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { useWorkflows, type StatusCategory, type Workflow } from './api';

const ANY_ID = '__any__';
const CATEGORY_VAR: Record<StatusCategory, string> = {
  TODO: 'var(--status-todo)', IN_PROGRESS: 'var(--status-progress)', DONE: 'var(--status-done)',
};
const CATEGORY_LABEL: Record<StatusCategory, string> = {
  TODO: 'Cần làm', IN_PROGRESS: 'Đang làm', DONE: 'Hoàn thành',
};
const CATEGORY_COL: Record<StatusCategory, number> = { TODO: 1, IN_PROGRESS: 2, DONE: 3 };
const COL_W = 240;
const ROW_H = 104;

type NodeData = { label: string; isAny?: boolean; category?: StatusCategory; color?: string | null; isInitial?: boolean; isCurrent?: boolean };

function autoLayout(wf: Workflow): Record<string, { x: number; y: number }> {
  const counts: Record<StatusCategory, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
  const pos: Record<string, { x: number; y: number }> = { [ANY_ID]: { x: 0, y: 24 } };
  for (const s of [...wf.statuses].sort((a, b) => a.order - b.order)) {
    pos[s.id] = { x: CATEGORY_COL[s.category] * COL_W, y: 24 + counts[s.category] * ROW_H };
    counts[s.category] += 1;
  }
  return pos;
}

function buildNodes(wf: Workflow, currentStatusId: string): Node<NodeData>[] {
  const pos = autoLayout(wf);
  const usesAny = wf.transitions.some((t) => t.fromStatusId == null);
  const nodes: Node<NodeData>[] = [];
  if (usesAny) {
    nodes.push({ id: ANY_ID, type: 'wf', position: pos[ANY_ID], data: { label: 'Bất kỳ trạng thái', isAny: true }, draggable: false });
  }
  for (const s of wf.statuses) {
    nodes.push({
      id: s.id,
      type: 'wf',
      position: pos[s.id] ?? { x: 0, y: 0 },
      draggable: false,
      data: { label: s.name, category: s.category, color: s.color, isInitial: s.isInitial, isCurrent: s.id === currentStatusId },
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

/** Node trạng thái chỉ-đọc; tô đậm trạng thái hiện tại. */
function StatusNode({ data }: NodeProps<NodeData>) {
  if (data.isAny) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-surface-2 px-3 py-2 text-sm text-muted">
        {data.label}
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-2 !border-surface !bg-faint" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'relative min-w-[150px] rounded-lg border bg-surface px-3 py-2 shadow-sm',
        data.isCurrent ? 'border-primary ring-2 ring-[var(--ring)]' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-2 !border-surface !bg-[var(--border-strong)]" />
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: data.color || (data.category ? CATEGORY_VAR[data.category] : 'var(--faint)') }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-strong">{data.label}</span>
        {data.isCurrent && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-fg">Hiện tại</span>}
        {!data.isCurrent && data.isInitial && <span className="rounded bg-primary-subtle px-1 py-0.5 text-[10px] font-medium text-primary">Khởi tạo</span>}
      </div>
      {data.category && <span className="mt-0.5 block text-[11px] text-faint">{CATEGORY_LABEL[data.category]}</span>}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-2 !border-surface !bg-primary" />
    </div>
  );
}

const nodeTypes = { wf: StatusNode };

function FitView({ dep }: { dep: string }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => { if (initialized) fitView({ padding: 0.2, duration: 0 }); }, [initialized, dep, fitView]);
  return null;
}

/**
 * Popup xem QUY TRÌNH (chỉ đọc) của workflow chứa trạng thái hiện tại; tô đậm trạng thái đang ở.
 */
export function WorkflowViewDialog({
  open,
  onClose,
  currentStatusId,
  currentStatusName,
}: {
  open: boolean;
  onClose: () => void;
  currentStatusId: string;
  currentStatusName?: string;
}) {
  const { data: workflows, isLoading } = useWorkflows();

  const workflow = useMemo(
    () => (workflows ?? []).find((wf) => wf.statuses.some((s) => s.id === currentStatusId)) ?? null,
    [workflows, currentStatusId],
  );

  const nodes = useMemo(() => (workflow ? buildNodes(workflow, currentStatusId) : []), [workflow, currentStatusId]);
  const edges = useMemo(() => (workflow ? buildEdges(workflow) : []), [workflow]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div className="relative flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="text-sm font-medium text-ink">
            Quy trình{workflow ? `: ${workflow.name}` : ''}
          </span>
          {currentStatusName && (
            <span className="rounded bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">Hiện tại: {currentStatusName}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="ml-auto grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 bg-surface-2">
          {isLoading ? (
            <div className="grid h-full place-items-center"><DelayedSpinner /></div>
          ) : !workflow ? (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-muted">
              Không tìm thấy quy trình cho trạng thái này.
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              proOptions={{ hideAttribution: true }}
            >
              <FitView dep={workflow.id} />
              <Background gap={16} color="var(--border)" />
              <Controls showInteractive={false} className="!border-border !bg-surface !shadow-md" />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
}
