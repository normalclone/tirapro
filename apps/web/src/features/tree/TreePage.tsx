import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, ListTree } from 'lucide-react';
import { useProject } from '@/features/projects/api';
import { useProjectIssues } from '@/features/backlog/api';
import { DueBadge } from '@/components/ui/DueBadge';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { Avatar, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { categoryColor } from '@/lib/statusColor';
import { buildIssueTree, buildProgressMap, type IssueTreeNode, type SubtreeProgress } from '@/lib/issueTree';
import { cn } from '@/lib/utils';

/**
 * Bố cục cột dùng chung cho hàng tiêu đề (header) và mọi hàng dữ liệu, để các cột
 * luôn thẳng hàng dù nội dung dài ngắn khác nhau. Cột đầu co giãn (tiêu đề), phần
 * còn lại cố định bề rộng cho dễ quét mắt.
 */
const GRID_COLS = 'grid grid-cols-[minmax(0,1fr)_9rem_11rem_6rem_4.5rem] items-center gap-3';

/** Bậc thụt lề mỗi cấp (px) ở cột tiêu đề. */
const INDENT_STEP = 20;

/** Làm phẳng cây thành danh sách hàng hiển thị, tôn trọng node đang thu gọn. */
function flatten(nodes: IssueTreeNode[], collapsed: Set<string>, out: IssueTreeNode[] = []): IssueTreeNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.children.length && !collapsed.has(n.issue.id)) flatten(n.children, collapsed, out);
  }
  return out;
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
  const { data: project, isLoading: lp, isError: pe, error: pErr, refetch: refetchProject } = useProject(key);
  const issuesQ = useProjectIssues(project?.id);
  const { data: issues, isLoading: li } = issuesQ;
  const isLoading = lp || li;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildIssueTree(issues ?? []), [issues]);
  const progressById = useMemo(() => buildProgressMap(issues ?? []), [issues]);
  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);
  const parentIds = useMemo(() => collectParentIds(tree), [tree]);

  const allCollapsed = parentIds.size > 0 && collapsed.size >= parentIds.size;

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setCollapsed(allCollapsed ? new Set() : new Set(parentIds));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {pe || issuesQ.isError ? (
          <div className={pageContainer('lg')}>
            <QueryError
              error={pErr ?? issuesQ.error}
              onRetry={() => { void refetchProject(); void issuesQ.refetch(); }}
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
              title="Chưa có issue nào"
              description="Tạo issue và đặt 'Issue cha' trong trang chi tiết để dựng cây phân cấp."
            />
          </div>
        ) : (
          <div className={pageContainer('lg')}>
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
              <span>Trạng thái</span>
              <span>Người phụ trách</span>
              <span>Ưu tiên</span>
              <span className="text-right tabular">Điểm</span>
            </div>

            <ul className="divide-y divide-border">
              {rows.map((node) => (
                <TreeRow
                  key={node.issue.id}
                  node={node}
                  progress={progressById.get(node.issue.id)}
                  collapsed={collapsed.has(node.issue.id)}
                  onToggle={() => toggle(node.issue.id)}
                  onOpen={() => navigate(`/issue/${node.issue.key}`)}
                />
              ))}
            </ul>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  progress,
  collapsed,
  onToggle,
  onOpen,
}: {
  node: IssueTreeNode;
  progress?: SubtreeProgress;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { issue, children, depth } = node;
  const hasChildren = children.length > 0;
  const showProgress = hasChildren && progress && progress.total > 0;

  return (
    <li
      onClick={onOpen}
      className={cn(GRID_COLS, 'group cursor-pointer px-3 py-2 transition-colors hover:bg-surface-2')}
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
            <ChevronRight className={cn('h-4 w-4 transition-transform', !collapsed && 'rotate-90')} aria-hidden />
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
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title={issue.summary}
        >
          <span
            className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[10px] text-muted group-hover:bg-surface-3"
            style={issue.type.color ? { color: issue.type.color } : undefined}
          >
            {issue.type.name}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted">{issue.key}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink group-hover:text-ink-strong">{issue.summary}</span>
          {showProgress && <TaskProgress progress={progress} compact className="hidden w-24 shrink-0 lg:block" />}
          <DueBadge issue={issue} warnOnly className="shrink-0" />
        </button>
      </div>

      {/* Cột 2 — Trạng thái: chấm theo nhóm + tên trạng thái */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: categoryColor(issue.status.category) }}
          aria-hidden
        />
        <span className="truncate text-sm text-muted">{issue.status.name}</span>
      </div>

      {/* Cột 3 — Người phụ trách */}
      <div className="flex min-w-0 items-center gap-2">
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
      <div className="flex min-w-0 items-center gap-2">
        {issue.priority ? (
          <>
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: issue.priority.color ?? 'var(--faint)' }}
              aria-hidden
            />
            <span className="truncate text-sm text-muted">{issue.priority.name}</span>
          </>
        ) : (
          <span className="text-sm text-faint">—</span>
        )}
      </div>

      {/* Cột 5 — Story points (số căn phải, chữ số tabular) */}
      <span
        className={cn('text-right text-sm tabular', issue.storyPoints != null ? 'text-ink-strong' : 'text-faint')}
      >
        {issue.storyPoints ?? '—'}
      </span>
    </li>
  );
}
