/**
 * Phần dùng chung của hai sơ đồ quy trình (cài đặt `WorkflowGraph` và popup chỉ-đọc `WorkflowViewDialog`):
 * node, cung, dựng node/cung từ bố cục `workflowLayout`, nhấn mạnh đường đi khi chọn một trạng thái, canh khung ban đầu.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from 'reactflow';
import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';
import type { StatusCategory, Workflow } from './api';
import { fitViewport } from './workflowFit';
import {
  edgeEmphasis,
  escapeClears,
  nodeEmphasis,
  reachability,
  toggleSelection,
  type Emphasis,
  type PathWorkflow,
  type Reachability,
} from './workflowPaths';
import {
  NODE_H,
  NODE_W,
  type EdgeDir,
  type LayoutEdge,
  type WorkflowLayout,
} from './workflowLayout';

const CATEGORY_VAR: Record<string, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

export type NodeData = {
  label: string;
  category: StatusCategory;
  color?: string | null;
  isInitial?: boolean;
  /** Trạng thái hiện tại của việc (chỉ popup xem quy trình). */
  isCurrent?: boolean;
  anyTransitions: { id: string; name: string }[];
  strayTransitions: { id: string; name: string }[];
  onDelete?: (id: string) => void;
  onToggleAny?: (id: string) => void;
  onRemoveAny?: (transitionId: string) => void;
};

export type WfEdgeData = { path: string; dir: EdgeDir; label: LayoutEdge['label']; name: string };

type NodeHandlers = Pick<NodeData, 'onDelete' | 'onToggleAny' | 'onRemoveAny'>;

export function buildNodes(
  wf: Pick<Workflow, 'statuses'>,
  layout: WorkflowLayout,
  handlers: NodeHandlers = {},
  currentStatusId?: string,
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
        isCurrent: s.id === currentStatusId,
        anyTransitions: n.anyTransitions,
        strayTransitions: n.strayTransitions,
        ...handlers,
      },
    };
  });
}

/** Mũi tên do cung tự vẽ (marker riêng từng cung) để đổi màu theo mức nhấn mạnh. */
export function buildEdges(layout: WorkflowLayout): Edge<WfEdgeData>[] {
  return layout.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'wf',
    data: { path: e.path, dir: e.dir, label: e.label, name: e.name },
  }));
}

/* ---------- Chọn trạng thái → nhấn mạnh đường đi ---------- */

interface HighlightValue {
  selectedId: string | null;
  paths: Reachability | null;
}
const HighlightContext = createContext<HighlightValue>({ selectedId: null, paths: null });

export function HighlightProvider({
  workflow,
  selectedId,
  children,
}: {
  workflow: PathWorkflow;
  selectedId: string | null;
  children: ReactNode;
}) {
  const value = useMemo<HighlightValue>(() => {
    // Trạng thái đã chọn bị xoá/không thuộc quy trình → coi như không chọn (tránh làm mờ cả sơ đồ).
    if (!selectedId || !workflow.statuses.some((s) => s.id === selectedId))
      return { selectedId: null, paths: null };
    return { selectedId, paths: reachability(workflow, selectedId) };
  }, [workflow, selectedId]);
  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

/**
 * Trạng thái chọn của sơ đồ: bấm node = chọn/bỏ chọn, bấm nền = bỏ chọn, Esc = bỏ chọn.
 * `restingId`: chọn sẵn ban đầu (popup: trạng thái hiện tại). Esc chỉ bỏ chọn khi khác mặc định, để popup vẫn đóng được bằng Esc.
 * `hostOverlays`: số lớp phủ (hộp thoại/menu) đang mở mà bề mặt này được phép coi là "của mình". Còn nhiều hơn thế (vd hộp
 * xác nhận mở chồng lên) thì Esc dành cho lớp phủ đó. Bề mặt nằm trên trang: 0; trong một hộp thoại: 1.
 */
export function useStatusSelection(restingId: string | null, hostOverlays: number) {
  const [selectedId, setSelectedId] = useState<string | null>(restingId);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (openOverlayCount() > hostOverlays) return;
      if (!escapeClears(selectedRef.current, restingId)) return;
      e.stopPropagation(); // chặn Radix Dialog đóng popup: lần Esc này chỉ bỏ chọn
      setSelectedId(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [restingId, hostOverlays]);

  return {
    selectedId,
    onNodeClick: useCallback((e: ReactMouseEvent, node: { id: string }) => {
      // Nút sửa trong node (xoá, "từ mọi trạng thái"...) làm việc của nó, không đổi vùng chọn.
      if ((e.target as HTMLElement).closest('button')) return;
      setSelectedId((cur) => toggleSelection(cur, node.id));
    }, []),
    onPaneClick: useCallback(() => setSelectedId(null), []),
  };
}

/** Số lớp phủ Radix đang mở (hộp thoại, menu, popover) — cùng bộ chọn với `isOverlayOpen`. */
function openOverlayCount(): number {
  return document.querySelectorAll(
    [
      '[role="dialog"][data-state="open"]',
      '[role="alertdialog"][data-state="open"]',
      '[role="menu"][data-state="open"]',
      '[role="listbox"][data-state="open"]',
      '[data-radix-popper-content-wrapper]',
    ].join(','),
  ).length;
}

/* ---------- Cung ---------- */

const EDGE_STYLE: Record<
  Emphasis | 'base' | 'selected',
  { stroke: string; width: number; opacity: number }
> = {
  base: { stroke: 'var(--border-strong)', width: 1.5, opacity: 1 },
  selected: { stroke: 'var(--primary)', width: 2, opacity: 1 },
  direct: { stroke: 'var(--primary)', width: 2.5, opacity: 1 },
  future: { stroke: 'var(--primary)', width: 2, opacity: 0.5 },
  incoming: { stroke: 'var(--ink-strong)', width: 2, opacity: 1 },
  dim: { stroke: 'var(--border-strong)', width: 1.5, opacity: 0.25 },
};

const LABEL_CLS: Record<Emphasis | 'base', string> = {
  base: '',
  direct: 'border-primary bg-primary-subtle text-primary',
  future: 'border-primary text-primary',
  incoming: 'border-ink-strong text-ink-strong',
  dim: 'opacity-25',
};

/** Cung chuyển tiếp: path tính sẵn từ bố cục (không dùng toạ độ handle); nhãn là chip bấm để chọn. */
export function TransitionEdge({ id, data, selected }: EdgeProps<WfEdgeData>) {
  const { setEdges } = useReactFlow();
  const { paths } = useContext(HighlightContext);
  if (!data) return null;
  const back = data.dir === 'back';
  const emph = edgeEmphasis(paths, id);
  const look = EDGE_STYLE[emph ?? (selected ? 'selected' : 'base')];
  const stroke = emph === null && back && !selected ? 'var(--faint)' : look.stroke;
  const marker = `wf-arrow-${id}`;
  return (
    <>
      <defs>
        <marker
          id={marker}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="14"
          markerHeight="14"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} opacity={look.opacity} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={data.path}
        markerEnd={`url(#${marker})`}
        interactionWidth={16}
        style={{
          stroke,
          strokeWidth: look.width,
          opacity: look.opacity,
          strokeDasharray: back ? '5 4' : undefined,
          transition: 'opacity 150ms, stroke 150ms',
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
            'nodrag nopan pointer-events-auto absolute truncate rounded border bg-surface px-1.5 text-[11px] font-medium leading-none transition-opacity',
            emph
              ? LABEL_CLS[emph]
              : selected
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

/* ---------- Node ---------- */

const NODE_CLS = {
  selected: 'border-primary ring-2 ring-[var(--ring)]',
  direct: 'border-primary',
  future: 'border-primary/50',
  incoming: 'border-ink-strong',
  dim: 'opacity-25',
} as const;

/** Hàng phụ của node: nhóm trạng thái, huy hiệu chuyển tiếp không vẽ được / "từ mọi trạng thái". */
function NodeFooter({ id, data }: { id: string; data: NodeData }) {
  const any = data.anyTransitions;
  const stray = data.strayTransitions;
  return (
    <div className="mt-1 flex items-center justify-between gap-1">
      <span className="text-[11px] text-faint">
        {STATUS_CATEGORY_LABEL[data.category] ?? 'Chưa phân nhóm'}
      </span>
      {data.isCurrent && data.isInitial && (
        <span className="rounded bg-primary-subtle px-1 py-0.5 text-[10px] font-medium text-primary">
          Khởi tạo
        </span>
      )}
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
  );
}

/** Node trạng thái: chấm màu theo nhóm, tên, huy hiệu "Hiện tại"/"Khởi tạo", nút xoá (chỉ khi có `onDelete`). */
export function StatusNode({ id, data, selected }: NodeProps<NodeData>) {
  const { selectedId, paths } = useContext(HighlightContext);
  const emph = nodeEmphasis(paths, selectedId, id);
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      data-emphasis={emph ?? undefined}
      className={cn(
        'group relative rounded-lg border bg-surface px-3 py-2 shadow-sm transition-opacity',
        emph
          ? NODE_CLS[emph]
          : selected || data.isCurrent
            ? 'border-primary ring-2 ring-[var(--ring)]'
            : 'border-border',
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
        {data.isCurrent ? (
          <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-fg">
            Hiện tại
          </span>
        ) : (
          data.isInitial && (
            <span className="rounded bg-primary-subtle px-1 py-0.5 text-[10px] font-medium text-primary">
              Khởi tạo
            </span>
          )
        )}
      </div>
      <NodeFooter id={id} data={data} />
      {data.onDelete && (
        <button
          type="button"
          onClick={() => data.onDelete?.(id)}
          title="Xoá trạng thái"
          aria-label="Xoá trạng thái"
          className="nodrag absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-muted opacity-0 shadow-sm hover:text-danger focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
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

export const nodeTypes = { wf: StatusNode };
export const edgeTypes = { wf: TransitionEdge };

/* ---------- Canh khung ---------- */

/**
 * Canh khung theo biên bố cục (gồm cả các cung) SAU KHI node đã đo xong VÀ khung đã có kích thước thật (không phải 0 khi tab/popup
 * còn ẩn hoặc đang dựng). Canh lại khi đổi quy trình / số trạng thái / kích thước khung (đổi tab, đổi cỡ cửa sổ).
 * Lấp chiều ngang với lề 10%, zoom không dưới 0.5: đồ thị rộng hơn thì kéo để xem tiếp thay vì thu nhỏ khó đọc.
 */
export function AutoFit({ bounds, fitKey }: { bounds: WorkflowLayout['bounds']; fitKey: string }) {
  const { setViewport } = useReactFlow();
  const initialized = useNodesInitialized();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  useEffect(() => {
    if (!initialized) return;
    const v = fitViewport({ bounds: boundsRef.current, size: { width, height } });
    if (v) void setViewport(v, { duration: 0 });
  }, [initialized, fitKey, width, height, setViewport]);
  return null;
}
