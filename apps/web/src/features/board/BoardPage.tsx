import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { UserRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { BoardColumnDto, IssueDto } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import { DueBadge, dueBorderClass } from '@/components/ui/DueBadge';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { IssueTypeBadge } from '@/components/ui/IssueTypeBadge';
import { byPriorityThenStatus } from '@/lib/issueOrder';
import { buildProgressMap, type SubtreeProgress } from '@/lib/issueTree';
import { useBoardIssues, useBoards, useTransitionIssue } from './api';
import { useUpdateIssue } from '@/features/issues/api';
import { useProjectRealtime } from './useRealtime';
import { Avatar, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { QuickAddRow } from '@/components/ui/QuickAddRow';
import { categoryColor } from '@/lib/statusColor';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { QuickFilterChips } from '@/features/quick-filters/QuickFilterChips';
import { applyQuickFilters, useQuickFilters } from '@/features/quick-filters/useQuickFilters';
import { AssigneeFilter, applyAssigneeFilter } from '@/features/quick-filters/AssigneeFilter';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';

/** Phân bổ 1 tập issue vào các cột của board (đã sort trong cột). */
function distribute(board: { columns: BoardColumnDto[] }, list: IssueDto[]): Map<string, IssueDto[]> {
  const map = new Map<string, IssueDto[]>();
  for (const col of board.columns) map.set(col.id, []);
  for (const issue of list) {
    const col = board.columns.find((c) => c.statusIds.includes(issue.status.id));
    if (col) map.get(col.id)!.push(issue);
  }
  for (const l of map.values()) l.sort(byPriorityThenStatus);
  return map;
}

/** Roving focus giữa các card bằng phím mũi tên (theo data-lane/col/row). */
function focusCard(lane: number, col: number, row: number): boolean {
  const el = document.querySelector<HTMLElement>(`[data-board-card][data-lane="${lane}"][data-col="${col}"][data-row="${row}"]`);
  if (el) { el.focus(); return true; }
  return false;
}

/** Nội dung board (cột kéo-thả). Header/nav dự án + modal tạo issue nằm ở ProjectLayout. */
export function BoardPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: lp, isError: pe, error: pErr, refetch: refetchProject } = useProject(key);
  const boardsQ = useBoards(project?.id);
  const issuesQ = useBoardIssues(project?.id);
  const { data: boards, isLoading: lb } = boardsQ;
  const { data: issues, isLoading: li } = issuesQ;
  const transition = useTransitionIssue(project?.id ?? '');
  const updateIssue = useUpdateIssue(project?.id);
  const canTransition = useAuth((s) => s.can('issue:transition'));
  const canAssign = useAuth((s) => s.can('issue:assign'));
  const canCreate = useAuth((s) => s.can('issue:create'));
  const currentUserId = useAuth((s) => s.user?.id);
  const { active: quickFilters, toggle: toggleQuickFilter } = useQuickFilters();
  const [assignee, setAssignee] = useState('');
  const [groupBy, setGroupBy] = useState(false);
  const assigneeOptions = useAssigneeOptions(project?.id);
  const [dragging, setDragging] = useState<IssueDto | null>(null);
  useProjectRealtime(project?.id);

  // Nhớ lọc người + nhóm THEO DỰ ÁN (localStorage). Nạp khi đổi dự án.
  useEffect(() => {
    const pid = project?.id;
    if (!pid) return;
    try {
      const p = JSON.parse(localStorage.getItem(`tirapro:boardPrefs:${pid}`) || '{}');
      setAssignee(typeof p.assignee === 'string' ? p.assignee : '');
      setGroupBy(!!p.groupBy);
    } catch { setAssignee(''); setGroupBy(false); }
  }, [project?.id]);
  function writePrefs(next: { assignee?: string; groupBy?: boolean }) {
    const pid = project?.id;
    if (!pid) return;
    try { localStorage.setItem(`tirapro:boardPrefs:${pid}`, JSON.stringify({ assignee, groupBy, ...next })); } catch { /* ignore */ }
  }
  const changeAssignee = (v: string) => { setAssignee(v); writePrefs({ assignee: v }); };
  const toggleGroupBy = () => setGroupBy((g) => { const n = !g; writePrefs({ groupBy: n }); return n; });

  const board = boards?.[0];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  // Lọc: bộ lọc nhanh (AND) + người phụ trách. Đếm cột/làn dựa trên tập này.
  const filteredIssues = useMemo(() => {
    const base = applyQuickFilters(issues ?? [], quickFilters, currentUserId);
    return applyAssigneeFilter(base, assignee);
  }, [issues, quickFilters, currentUserId, assignee]);

  const byColumn = useMemo(() => (board ? distribute(board, filteredIssues) : new Map<string, IssueDto[]>()), [board, filteredIssues]);

  // Làn (swimlane) theo người phụ trách khi bật nhóm.
  const lanes = useMemo(() => {
    if (!groupBy) return null;
    const byUser = new Map<string, { key: string; name: string; avatarUrl: string | null; issues: IssueDto[] }>();
    const unassigned: IssueDto[] = [];
    for (const i of filteredIssues) {
      if (!i.assignee) { unassigned.push(i); continue; }
      const k = i.assignee.id;
      if (!byUser.has(k)) byUser.set(k, { key: k, name: i.assignee.displayName, avatarUrl: i.assignee.avatarUrl, issues: [] });
      byUser.get(k)!.issues.push(i);
    }
    const arr = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    if (unassigned.length) arr.push({ key: '__unassigned__', name: 'Chưa gán', avatarUrl: null, issues: unassigned });
    return arr;
  }, [groupBy, filteredIssues]);

  const progressMap = useMemo(() => buildProgressMap(issues ?? []), [issues]);

  function onDragStart(e: DragStartEvent) {
    setDragging((issues ?? []).find((i) => i.id === e.active.id) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const issue = (issues ?? []).find((i) => i.id === e.active.id);
    // Droppable id = "laneKey::colId" (chế độ nhóm) hoặc "colId" (phẳng).
    const overId = e.over ? String(e.over.id) : '';
    if (!issue || !overId) return;
    const grouped = overId.includes('::');
    const laneKey = grouped ? overId.split('::')[0]! : null;
    const colId = grouped ? overId.split('::')[1]! : overId;
    const col = board?.columns.find((c) => c.id === colId);
    if (!col) return;

    const statusChanged = canTransition && !col.statusIds.includes(issue.status.id);

    // Board phẳng: giữ nguyên hành vi cũ (chuyển trạng thái + Hoàn tác).
    if (!grouped) {
      if (!statusChanged) return;
      const fromStatusId = issue.status.id;
      const fromStatusName = issue.status.name;
      const fromVersion = issue.version;
      transition.mutate(
        { id: issue.id, toStatusId: col.statusIds[0], version: fromVersion, statusName: col.name } as never,
        {
          onError: (err) => toast.error(apiErrorMessage(err)),
          onSuccess: () =>
            toast.success(`${issue.key} → ${col.name}`, {
              duration: 4000,
              action: {
                label: 'Hoàn tác',
                onClick: () =>
                  transition.mutate(
                    { id: issue.id, toStatusId: fromStatusId, version: fromVersion + 1, statusName: fromStatusName } as never,
                    { onError: (err) => toast.error(apiErrorMessage(err)) },
                  ),
              },
            }),
        },
      );
      return;
    }

    // Swimlane: thả sang làn khác → đổi người phụ trách ("Chưa gán" = bỏ gán); có thể kèm đổi trạng thái.
    const targetAssignee: string | null = laneKey === '__unassigned__' ? null : laneKey;
    const assigneeChanged = canAssign && targetAssignee !== (issue.assigneeId ?? null);
    if (!statusChanged && !assigneeChanged) return;
    try {
      let version = issue.version;
      if (assigneeChanged) {
        const updated = await updateIssue.mutateAsync({ id: issue.id, key: issue.key, patch: { assigneeId: targetAssignee }, version });
        version = updated.data.version;
      }
      if (statusChanged) {
        await transition.mutateAsync({ id: issue.id, toStatusId: col.statusIds[0], version, statusName: col.name } as never);
      }
      const who = targetAssignee == null ? 'Chưa gán' : assigneeOptions.find((o) => o.id === targetAssignee)?.name ?? 'người khác';
      const parts = [statusChanged ? `→ ${col.name}` : '', assigneeChanged ? `· ${who}` : ''].filter(Boolean).join(' ');
      toast.success(`${issue.key} ${parts}`.trim(), { duration: 3000 });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  if (pe) {
    return <div className="p-6"><QueryError error={pErr} onRetry={() => refetchProject()} /></div>;
  }

  if (boardsQ.isError || issuesQ.isError) {
    return (
      <div className="p-6">
        <QueryError error={boardsQ.error ?? issuesQ.error} onRetry={() => { void boardsQ.refetch(); void issuesQ.refetch(); }} />
      </div>
    );
  }

  if (lp || lb || li) {
    return (
      <div className="p-6">
        <div className="flex gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 w-[21.6rem] shrink-0" />)}</div>
        <DelayedSpinner />
      </div>
    );
  }

  if (!board) {
    return <div className="p-6"><EmptyState title="Chưa có board" description="Dự án này chưa có board nào." /></div>;
  }

  const openIssue = (k: string) => navigate(`/issue/${k}`);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3">
          <QuickFilterChips active={quickFilters} onToggle={toggleQuickFilter} />
          <AssigneeFilter options={assigneeOptions} value={assignee} onChange={changeAssignee} />
          <button
            type="button"
            aria-pressed={groupBy}
            onClick={toggleGroupBy}
            title="Nhóm board theo người phụ trách"
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              groupBy ? 'border-transparent bg-primary-subtle text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Users className="h-3.5 w-3.5" /> Nhóm theo người
          </button>
        </div>

        {groupBy && lanes ? (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4">
            {lanes.length === 0 ? (
              <p className="py-10 text-center text-sm text-faint">Không có việc khớp bộ lọc.</p>
            ) : (
              lanes.map((lane, laneIdx) => {
                const laneCols = distribute(board, lane.issues);
                return (
                  <section key={lane.key}>
                    <div className="mb-2 flex items-center gap-2">
                      {lane.key === '__unassigned__' ? (
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-faint"><UserRound className="h-3.5 w-3.5" /></span>
                      ) : (
                        <Avatar name={lane.name} src={lane.avatarUrl} size={24} />
                      )}
                      <span className="text-sm font-semibold text-ink-strong">{lane.name}</span>
                      <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-muted">{lane.issues.length}</span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-1">
                      {board.columns.map((col, colIdx) => (
                        <Column
                          key={col.id}
                          col={col}
                          issues={laneCols.get(col.id) ?? []}
                          progressMap={progressMap}
                          onOpen={openIssue}
                          projectKey={key}
                          projectId={project?.id ?? ''}
                          canCreate={false}
                          droppableId={`${lane.key}::${col.id}`}
                          laneIdx={laneIdx}
                          colIdx={colIdx}
                          grouped
                        />
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
            {board.columns.map((col, colIdx) => (
              <Column
                key={col.id}
                col={col}
                issues={byColumn.get(col.id) ?? []}
                progressMap={progressMap}
                onOpen={openIssue}
                projectKey={key}
                projectId={project?.id ?? ''}
                canCreate={canCreate}
                laneIdx={0}
                colIdx={colIdx}
              />
            ))}
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>{dragging ? <Card issue={dragging} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  col, issues, progressMap, onOpen, projectKey, projectId, canCreate, droppableId, laneIdx = 0, colIdx = 0, grouped = false,
}: {
  col: BoardColumnDto;
  issues: IssueDto[];
  progressMap: Map<string, SubtreeProgress>;
  onOpen: (key: string) => void;
  projectKey: string;
  projectId: string;
  canCreate: boolean;
  droppableId?: string;
  laneIdx?: number;
  colIdx?: number;
  grouped?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId ?? col.id });
  const dot = issues[0] ? categoryColor(issues[0].status.category) : 'var(--status-todo)';
  const columnStatusId = col.statusIds[0];
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[21.6rem] shrink-0 flex-col rounded-lg bg-surface-3 transition-colors',
        grouped && 'self-start',
        isOver && 'ring-2 ring-[var(--ring)]',
      )}
    >
      <div className="sticky top-0 flex items-center gap-2 px-3 py-2.5">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
        <span className="text-sm font-medium text-ink">{col.name}</span>
        <span className="tabular ml-auto text-xs text-muted">{issues.length}{col.wipLimit ? `/${col.wipLimit}` : ''}</span>
      </div>
      <div className={cn('flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2', grouped && 'min-h-[3rem]')}>
        {issues.map((issue, rowIdx) => (
          <Card key={issue.id} issue={issue} progress={progressMap.get(issue.id)} onOpen={onOpen} laneIdx={laneIdx} colIdx={colIdx} rowIdx={rowIdx} />
        ))}
        {issues.length === 0 && <p className="px-2 py-6 text-center text-xs text-faint">Trống</p>}
      </div>
      {canCreate && columnStatusId && projectId && (
        <QuickAddRow projectKey={projectKey} projectId={projectId} extra={{ statusId: columnStatusId }} placeholder="+ Thêm việc…" compact />
      )}
    </div>
  );
}

/** Chip nhãn nhỏ trên card. */
function LabelChip({ name, color }: { name: string; color: string | null }) {
  const c = color || 'var(--faint)';
  return (
    <span
      className="max-w-[8rem] truncate rounded px-1.5 py-px text-[10px] font-medium"
      style={{ backgroundColor: `color-mix(in oklch, ${c} 16%, transparent)`, color: c }}
    >
      {name}
    </span>
  );
}

function Card({
  issue, overlay, progress, onOpen, laneIdx = 0, colIdx = 0, rowIdx = 0,
}: {
  issue: IssueDto;
  overlay?: boolean;
  progress?: SubtreeProgress;
  onOpen?: (key: string) => void;
  laneIdx?: number;
  colIdx?: number;
  rowIdx?: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: issue.id });
  const labels = issue.labels ?? [];

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { onOpen?.(issue.key); return; }
    const map: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    const [dc, dr] = d;
    if (!focusCard(laneIdx, colIdx + dc, rowIdx + dr) && dc !== 0) focusCard(laneIdx, colIdx + dc, 0);
  }

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : { 'data-board-card': true, 'data-lane': laneIdx, 'data-col': colIdx, 'data-row': rowIdx })}
      onClick={() => onOpen?.(issue.key)}
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'cursor-grab touch-none rounded-md border bg-surface p-2.5 shadow-sm transition-shadow',
        dueBorderClass(issue) || 'border-border',
        'hover:shadow-md active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        isDragging && 'opacity-40',
        overlay && 'rotate-1 shadow-lg',
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <IssueTypeBadge name={issue.type.name} color={issue.type.color} />
        <div className="ml-auto flex items-center gap-2">
          <DueBadge issue={issue} warnOnly />
          {issue.storyPoints != null && (
            <span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-surface-2 px-1 text-[10px] font-medium text-muted">{issue.storyPoints}</span>
          )}
        </div>
      </div>

      <p className="mb-1.5 line-clamp-2 text-sm text-ink-strong">{issue.summary}</p>

      {labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {labels.slice(0, 3).map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />)}
          {labels.length > 3 && <span className="text-[10px] text-faint">+{labels.length - 3}</span>}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted">{issue.key}</span>
        {issue.priority && <span className="h-1.5 w-1.5 rounded-full" style={{ background: issue.priority.color ?? 'var(--faint)' }} title={issue.priority.name} />}
        <div className="ml-auto flex min-w-0 items-center">
          {issue.assignee ? (
            <span className="flex min-w-0 items-center gap-1" title={`Người làm: ${issue.assignee.displayName}`}>
              <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={18} />
              <span className="max-w-[6.5rem] truncate text-xs text-muted">{issue.assignee.displayName}</span>
            </span>
          ) : (
            <span className="whitespace-nowrap text-[11px] text-faint">Chưa gán</span>
          )}
        </div>
      </div>

      {progress && progress.total > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <TaskProgress progress={progress} compact className="flex-1" />
          <span className="tabular shrink-0 text-[10px] text-faint">{progress.done}/{progress.total}</span>
        </div>
      )}
    </div>
  );
}
