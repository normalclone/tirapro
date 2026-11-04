import { useMemo } from 'react';
import ReactFlow, { Background, Controls, Panel } from 'reactflow';
import 'reactflow/dist/style.css';
import { Dialog } from '@/components/ui/Dialog';
import { DelayedSpinner } from '@/components/ui/primitives';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { useWorkflows, type Workflow } from './api';
import { layoutWorkflow } from './workflowLayout';
import {
  AutoFit,
  buildEdges,
  buildNodes,
  edgeTypes,
  HighlightProvider,
  nodeTypes,
  useStatusSelection,
} from './WorkflowFlowParts';

/** Sơ đồ chỉ-đọc: cùng bố cục không chạm nhau + cung/node với trang cài đặt; chọn sẵn trạng thái hiện tại của việc. */
function ReadOnlyGraph({
  workflow,
  currentStatusId,
}: {
  workflow: Workflow;
  currentStatusId: string;
}) {
  const layout = useMemo(() => layoutWorkflow(workflow), [workflow]);
  const nodes = useMemo(
    () => buildNodes(workflow, layout, {}, currentStatusId),
    [workflow, layout, currentStatusId],
  );
  const edges = useMemo(() => buildEdges(layout), [layout]);
  const { selectedId, onNodeClick, onPaneClick } = useStatusSelection(
    currentStatusId,
    Number.POSITIVE_INFINITY,
  );
  return (
    <HighlightProvider workflow={workflow} selectedId={selectedId}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        minZoom={0.3}
        proOptions={{ hideAttribution: true }}
      >
        <AutoFit bounds={layout.bounds} fitKey={`${workflow.id}:${workflow.statuses.length}`} />
        <Background gap={16} color="var(--border)" />
        <Controls showInteractive={false} className="!border-border !bg-surface !shadow-md" />
        <Panel position="bottom-right">
          <p className="rounded-md border border-border bg-surface/90 px-2.5 py-1.5 text-xs text-muted shadow-sm">
            Bấm một trạng thái để xem đường đi của nó · bấm nền hoặc Esc để bỏ chọn
          </p>
        </Panel>
      </ReactFlow>
    </HighlightProvider>
  );
}

/**
 * Popup xem QUY TRÌNH (chỉ đọc) của workflow chứa trạng thái hiện tại; đánh dấu trạng thái đang ở và làm nổi đường đi của nó.
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
  const workflowsQuery = useWorkflows();
  const { data: workflows } = workflowsQuery;

  const workflow = useMemo(
    () => (workflows ?? []).find((wf) => wf.statuses.some((s) => s.id === currentStatusId)) ?? null,
    [workflows, currentStatusId],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Quy trình${workflow ? `: ${workflow.name}` : ''}`}
      headerExtra={
        currentStatusName && (
          <span className="shrink-0 rounded bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
            Hiện tại: {currentStatusName}
          </span>
        )
      }
      size="xl"
      className="h-[80vh] max-w-[min(96vw,1500px)]"
      bodyClassName="relative p-0"
    >
      <div className="absolute inset-0 bg-surface-2">
        <QueryBoundary
          query={workflowsQuery}
          skeleton={
            <div className="grid h-full place-items-center">
              <DelayedSpinner />
            </div>
          }
        >
          {() =>
            workflow ? (
              <ReadOnlyGraph
                key={`${workflow.id}:${currentStatusId}`}
                workflow={workflow}
                currentStatusId={currentStatusId}
              />
            ) : (
              <div className="grid h-full place-items-center px-6 text-center text-sm text-muted">
                Không tìm thấy quy trình cho trạng thái này.
              </div>
            )
          }
        </QueryBoundary>
      </div>
    </Dialog>
  );
}
