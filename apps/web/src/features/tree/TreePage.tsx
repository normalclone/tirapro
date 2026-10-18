import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, CornerUpLeft, ListTree } from 'lucide-react';
import { DndContext, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/core';
import { useProject } from '@/features/projects/api';
import { useProjectIssues } from '@/features/issues/api';
import { DueBadge } from '@/components/ui/DueBadge';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { Avatar, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { categoryColor } from '@/lib/statusColor';
import {
  buildIssueTree,
  buildProgressMap,
  type IssueTreeNode,
  type SubtreeProgress,
} from '@/lib/issueTree';
import { buildRowRollups, type PointsRollup } from '@/lib/epic';
import { cn } from '@/lib/utils';
import { pointsCell } from './pointsCell';
import { ROOT_DROP_ID, rowDropId, useTreeDrag, type DropState } from './useTreeDrag';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { usePriorityRanks } from '@/features/settings-admin/api';

/**
 * Bố cục cột dùng chung cho hàng tiêu đề (header) và mọi hàng dữ liệu, để các cột
 * luôn thẳng hàng dù nội dung dài ngắn khác nhau. Cột đầu co giãn (tiêu đề), phần
 * còn lại cố định bề rộng cho dễ quét mắt. Dưới `sm` chỉ còn cột tiêu đề (4 cột phụ không vừa 390px): trạng thái
 * hiện bằng chấm màu cạnh mã, hạn chót vẫn có nhãn.
 */
const GRID_COLS =
  'grid grid-cols-[minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_11rem_6rem_4.5rem]';

/** Bậc thụt lề mỗi cấp (px) ở cột tiêu đề. */
const INDENT_STEP = 20;

/** Làm phẳng cây thành danh sách hàng hiển thị, tôn trọng node đang thu gọn. */
function flatten(
  nodes: IssueTreeNode[],
  collapsed: Set<string>,
  out: IssueTreeNode[] = [],
): IssueTreeNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.children.length && !collapsed.has(n.issue.id)) flatten(n.children, collapsed, out);
  }
  return out;
}

/** Bản sao của `set` không có `id` (giữ nguyên tham chiếu nếu `id` vốn không có để khỏi vẽ lại thừa). */
function without(set: Set<string>, id: string): Set<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

/** Tập id của mọi node có con (để hỗ trợ "thu gọn tất cả"). */
function collectParentIds(nodes: IssueTreeNode[], out: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.children.length) {
      out.add(n.issue.id);
      collectParentIds(n.children, out);
    }
  }
  return out;
}

export function TreePage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const {
    data: project,
    isLoading: lp,
    isError: pe,
    error: pErr,
    refetch: refetchProject,
  } = useProject(key);
  const issuesQ = useProjectIssues(project?.id);
  const { data: issues, isLoading: li } = issuesQ;
  const isLoading = lp || li;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildIssueTree(issues ?? []), [issues]);
  const progressById = useMemo(() => buildProgressMap(issues ?? []), [issues]);
  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);
  const parentIds = useMemo(() => collectParentIds(tree), [tree]);
  // Điểm cộng dồn dựng một lần theo `issues` (Epic dùng định nghĩa thành viên epic dùng chung với panel Epic/Việc chờ).
  const rollups = useMemo(() => buildRowRollups(issues ?? [], parentIds), [issues, parentIds]);

  const allCollapsed = parentIds.size > 0 && collapsed.size >= parentIds.size;

  // Sau khi thả, mở nhánh đích để thấy ngay việc vừa vào.
  const drag = useTreeDrag(project?.id, issues, (id) => setCollapsed((prev) => without(prev, id)));
  const { canEditIssue, canEditAny, dragged, dragId, overId } = drag;

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setCollapsed(allCollapsed ? new Set() : new Set(parentIds));
  }

  return (
    <DndContext {...drag.dndProps}>
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-auto pb-6 lg:pb-24">
          {pe || issuesQ.isError ? (
            <div className={pageContainer('lg')}>
              <QueryError
                error={pErr ?? issuesQ.error}
                onRetry={() => {
                  void refetchProject();
                  if (!pe) void issuesQ.refetch();
                }}
              />
            </div>
          ) : isLoading ? (
            <div className={pageContainer('lg', 'space-y-1.5')}>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
              <DelayedSpinner />
            </div>
          ) : rows.length === 0 ? (
            <div className={pageContainer('lg')}>
              <EmptyState
                icon={<ListTree className="h-8 w-8" aria-hidden />}
                title="Chưa có công việc nào"
                description="Mở một công việc, đặt trường “Việc cha” cho nó — cây phân cấp sẽ tự hiện ở đây."
              />
            </div>
          ) : (
            <div className={pageContainer('lg')}>
              {canEditAny && (
                <p className="mb-2 text-xs text-faint">
                  Kéo một dòng thả lên dòng khác để đổi Epic / Việc cha. Không kéo được? Mở công
                  việc và đổi ở ô “Epic / Việc cha”.
                </p>
              )}
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                {/* Hàng tiêu đề cột — dính khi cuộn để luôn biết đang xem cột nào */}
                <div
                  className={cn(
                    GRID_COLS,
                    'sticky top-0 z-10 border-b border-border bg-surface-2 px-3 py-2',
                    'text-[11px] font-medium uppercase tracking-wide text-faint',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleAll}
                      disabled={parentIds.size === 0}
                      aria-label={allCollapsed ? 'Mở rộng tất cả' : 'Thu gọn tất cả'}
                      title={allCollapsed ? 'Mở rộng tất cả' : 'Thu gọn tất cả'}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint hover:bg-surface-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                    >
                      {allCollapsed ? (
                        <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </button>
                    <span>Tiêu đề</span>
                  </div>
                  <span className="max-sm:hidden">Trạng thái</span>
                  <span className="max-sm:hidden">Người phụ trách</span>
                  <span className="max-sm:hidden">Ưu tiên</span>
                  <span
                    className="text-right tabular max-sm:hidden"
                    title="Dòng có việc bên trong hiện điểm cộng dồn: đã xong / tổng"
                  >
                    Điểm
                  </span>
                </div>

                <ul className="divide-y divide-border">
                  {rows.map((node) => (
                    <TreeRow
                      key={node.issue.id}
                      node={node}
                      progress={progressById.get(node.issue.id)}
                      rollup={rollups.get(node.issue.id) ?? null}
                      collapsed={collapsed.has(node.issue.id)}
                      canDrag={canEditIssue(node.issue)}
                      dragging={dragId === node.issue.id}
                      dropState={drag.dropStateOf(node.issue.id)}
                      onToggle={() => toggle(node.issue.id)}
                      onOpen={() => navigate(`/issue/${node.issue.key}`)}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
        {/* Ngoài khung cuộn: không phủ lên dòng nào, vị trí không phụ thuộc cuộn/tự cuộn khi kéo. */}
        {dragId && <RootDropZone active={overId === ROOT_DROP_ID} />}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className="flex max-w-md items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-lg">
            <span className="shrink-0 font-mono text-xs text-muted">{dragged.key}</span>
            <span className="min-w-0 truncate text-ink-strong">{dragged.summary}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Vùng thả "Đưa ra ngoài" — chỉ hiện khi đang kéo, nằm dưới khung cuộn của cây nên luôn thấy dù cây dài. */
function RootDropZone({ active }: { active: boolean }) {
  const { setNodeRef } = useDroppable({ id: ROOT_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mx-4 mb-3 mt-1 flex shrink-0 items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-3 text-sm',
        active
          ? 'border-[var(--ring)] bg-surface-2 text-ink-strong ring-2 ring-[var(--ring)]'
          : 'border-border bg-surface text-muted',
      )}
    >
      <CornerUpLeft className="h-4 w-4" aria-hidden />
      Thả vào đây để đưa ra ngoài Epic/việc cha
    </div>
  );
}

function TreeRow({
  node,
  progress,
  rollup,
  collapsed,
  canDrag,
  dragging,
  dropState,
  onToggle,
  onOpen,
}: {
  node: IssueTreeNode;
  progress?: SubtreeProgress;
  rollup: PointsRollup | null;
  collapsed: boolean;
  canDrag: boolean;
  dragging: boolean;
  dropState: DropState;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { issue, children, depth } = node;
  const hasChildren = children.length > 0;
  const showProgress = hasChildren && progress && progress.total > 0;
  const cell = pointsCell(issue.storyPoints ?? null, rollup);
  const drag = useDraggable({ id: issue.id, disabled: !canDrag });
  const drop = useDroppable({ id: rowDropId(issue.id) });
  const ranks = usePriorityRanks();

  return (
    <li
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      {...drag.listeners}
      onClick={onOpen}
      data-dragging={dragging || undefined}
      className={cn(
        GRID_COLS,
        'group cursor-pointer px-3 py-2 transition-colors hover:bg-surface-2',
        dragging && 'opacity-40',
        dropState === 'ok' && 'bg-surface-2 ring-2 ring-inset ring-[var(--ring)]',
        dropState === 'bad' && 'cursor-not-allowed ring-2 ring-inset ring-danger',
      )}
    >
      {/* Cột 1 — Tiêu đề: thụt lề theo cấp + chevron + loại + key + summary + tiến độ con */}
      <div className="flex min-w-0 items-center gap-2">
        <span style={{ width: depth * INDENT_STEP }} className="shrink-0" aria-hidden />
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // chỉ đóng/mở nhánh, không mở issue
              onToggle();
            }}
            aria-label={collapsed ? 'Mở rộng' : 'Thu gọn'}
            aria-expanded={!collapsed}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:bg-surface-3 hover:text-ink"
          >
            <ChevronRight
              className={cn('h-4 w-4 transition-transform', !collapsed && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden />
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left focus-visible:rounded max-sm:py-1 sm:flex-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title={issue.summary}
        >
          <span
            role="img"
            aria-label={`Trạng thái: ${issue.status.name}`}
            title={issue.status.name}
            className="h-2 w-2 shrink-0 rounded-full sm:hidden"
            style={{ background: categoryColor(issue.status.category) }}
          />
          <span
            className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[10px] text-muted group-hover:bg-surface-3"
            style={issue.type.color ? { color: issue.type.color } : undefined}
          >
            {issue.type.name}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted">{issue.key}</span>
          <span className="min-w-0 text-sm text-ink group-hover:text-ink-strong max-sm:order-last max-sm:basis-full max-sm:line-clamp-2 sm:flex-1 sm:truncate">
            {issue.summary}
          </span>
          {showProgress && (
            <TaskProgress progress={progress} compact className="hidden w-24 shrink-0 lg:block" />
          )}
          <DueBadge issue={issue} warnOnly className="shrink-0" />
        </button>
      </div>

      {/* Cột 2 — Trạng thái: chấm theo nhóm + tên trạng thái */}
      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: categoryColor(issue.status.category) }}
          aria-hidden
        />
        <span className="truncate text-sm text-muted">{issue.status.name}</span>
      </div>

      {/* Cột 3 — Người phụ trách */}
      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        {issue.assignee ? (
          <>
            <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={20} />
            <span className="truncate text-sm text-ink">{issue.assignee.displayName}</span>
          </>
        ) : (
          <span className="text-sm text-faint">Chưa giao</span>
        )}
      </div>

      {/* Cột 4 — Ưu tiên */}
      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        {issue.priority ? (
          <>
            <span className="min-w-0 text-sm text-muted">
              <PriorityIcon
                withLabel
                name={issue.priority.name}
                rank={issue.priority.rank}
                ranks={ranks}
                color={issue.priority.color}
              />
            </span>
          </>
        ) : (
          <span className="text-sm text-faint">—</span>
        )}
      </div>

      {/* Cột 5 — Story points (số căn phải, chữ số tabular) */}
      <span
        className={cn(
          'hidden text-right text-sm tabular sm:block',
          cell.strong ? 'text-ink-strong' : 'text-faint',
        )}
        title={cell.title}
      >
        {cell.text}
      </span>
    </li>
  );
}
