import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { Layers, Settings, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import type { BoardColumnDto, BoardDto, IssueDto, SwimlaneBy } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import { DueBadge, dueBorderClass } from '@/components/ui/DueBadge';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { IssueTypeBadge } from '@/components/ui/IssueTypeBadge';
import { byPriorityThenStatus } from '@/lib/issueOrder';
import { buildProgressMap, type SubtreeProgress } from '@/lib/issueTree';
import { isWipLimitError, useBoardIssues, useBoards, useTransitionIssue, type TransitionVars } from './api';
import { BoardSettingsDialog, SWIMLANE_LABEL } from './BoardSettingsDialog';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { useProjectSprints } from '@/features/backlog/api';
import { useProjectIssues, useUpdateIssue } from '@/features/issues/api';
import { PresenceAvatars } from '@/features/presence/PresenceAvatars';
import { Avatar, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
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

/** Phân bổ 1 tập công việc vào các cột của bảng (đã sort trong cột). */
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

interface Lane { key: string; name: string; avatarUrl: string | null; issues: IssueDto[]; kind: SwimlaneBy; empty?: boolean }

const NO_LANE = '__none__';

/** Chia các việc thành làn (swimlane) theo cấu hình của bảng. `all` để tra tên epic/việc cha ngoài tập đang lọc. */
function buildLanes(by: SwimlaneBy, list: IssueDto[], all: IssueDto[]): Lane[] | null {
  if (by === 'none') return null;
  const byId = new Map(all.map((i) => [i.id, i]));
  const hasChildren = new Set(all.map((i) => i.parentId).filter((x): x is string => !!x));
  const groups = new Map<string, Lane & { order: number }>();
  const add = (key: string, name: string, avatarUrl: string | null, issue: IssueDto, order = 0, empty = false) => {
    let g = groups.get(key);
    if (!g) { g = { key, name, avatarUrl, issues: [], kind: by, order, empty }; groups.set(key, g); }
    g.issues.push(issue);
  };
  for (const i of list) {
    if (by === 'assignee') {
      if (i.assignee) add(i.assignee.id, i.assignee.displayName, i.assignee.avatarUrl, i);
      else add(NO_LANE, 'Chưa có người phụ trách', null, i, 0, true);
    } else if (by === 'priority') {
      if (i.priority) add(i.priority.id, i.priority.name, null, i, -i.priority.rank);
      else add(NO_LANE, 'Chưa đặt mức ưu tiên', null, i, 0, true);
    } else if (by === 'epic') {
      const epic = i.epicId ? byId.get(i.epicId) : undefined;
      if (i.epicId) add(i.epicId, epic ? `${epic.key} · ${epic.summary}` : 'Epic khác', null, i);
      else add(NO_LANE, 'Không thuộc epic nào', null, i, 0, true);
    } else {
      // parent: việc con ở cùng hàng với việc cha; việc cha không có con và việc lẻ vào hàng "việc độc lập"
      const parentId = i.parentId ?? (hasChildren.has(i.id) ? i.id : null);
      const parent = parentId ? byId.get(parentId) : undefined;
      if (parentId) add(parentId, parent ? `${parent.key} · ${parent.summary}` : 'Việc cha khác', null, i);
      else add(NO_LANE, 'Việc độc lập (không có việc cha/con)', null, i, 0, true);
    }
  }
  const named = [...groups.values()].filter((g) => !g.empty);
  if (by === 'priority') named.sort((a, b) => a.order - b.order);
  else named.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const rest = groups.get(NO_LANE);
  return (rest ? [...named, rest] : named).map(({ order: _o, ...lane }) => lane);
}

/**
 * Số việc tính vào giới hạn WIP của cột — CÙNG quy tắc với máy chủ: bảng Scrum chỉ đếm việc của sprint đang chạy
 * (không có sprint chạy = 0), bảng Kanban đếm cả dự án. Đếm trên tập CHƯA lọc để bộ lọc nhanh không làm lệch.
 */
function wipCount(col: BoardColumnDto, all: IssueDto[], board: BoardDto, activeSprintId: string | null): number {
  if (board.type === 'SCRUM' && !activeSprintId) return 0;
  return all.filter((i) => col.statusIds.includes(i.status.id) && (board.type !== 'SCRUM' || i.sprintId === activeSprintId)).length;
}

/** Roving focus giữa các card bằng phím mũi tên (theo data-lane/col/row). */
function focusCard(lane: number, col: number, row: number): boolean {
  const el = document.querySelector<HTMLElement>(`[data-board-card][data-lane="${lane}"][data-col="${col}"][data-row="${row}"]`);
  if (el) { el.focus(); return true; }
  return false;
}

/** Nội dung bảng công việc (cột kéo-thả). Header/nav dự án + popup tạo việc nằm ở ProjectLayout. */
export function BoardPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: lp, isError: pe, error: pErr, refetch: refetchProject } = useProject(key);
  const boardsQ = useBoards(project?.id);
  const projectIssuesQ = useProjectIssues(project?.id);
  const sprintsQ = useProjectSprints(project?.id);
  const { data: boards, isLoading: lb } = boardsQ;
  const board = boards?.[0];
  // Bảng có bộ lọc JQL → lấy tập việc khớp từ máy chủ; bảng thường đọc thẳng cache chung của dự án.
  const hasFilter = !!board?.filterJql?.trim();
  const boardIssuesQ = useBoardIssues(hasFilter ? board?.id : undefined);
  const projectIssues = projectIssuesQ.data;
  const li = projectIssuesQ.isLoading || (hasFilter && boardIssuesQ.isLoading);
  // Việc hiển thị: với bảng lọc, lấy bản MỚI NHẤT của từng việc từ cache dự án (vá lạc quan + realtime) để thẻ không cũ.
  const issues = useMemo(() => {
    if (!hasFilter) return projectIssues;
    const fresh = new Map((projectIssues ?? []).map((i) => [i.id, i]));
    return (boardIssuesQ.data ?? []).map((i) => fresh.get(i.id) ?? i);
  }, [hasFilter, projectIssues, boardIssuesQ.data]);
  // Cache dự án đổi (chuyển cột, realtime…) thì việc khớp bộ lọc có thể đổi → nạp lại tập khớp (gộp trong 400ms).
  const projectStamp = projectIssuesQ.dataUpdatedAt;
  const refetchBoardIssues = boardIssuesQ.refetch;
  useEffect(() => {
    if (!hasFilter) return;
    const t = setTimeout(() => { void refetchBoardIssues(); }, 400);
    return () => clearTimeout(t);
  }, [hasFilter, projectStamp, refetchBoardIssues]);
  const transition = useTransitionIssue(project?.id ?? '');
  const updateIssue = useUpdateIssue(project?.id);
  const canTransition = useAuth((s) => s.can('issue:transition'));
  const canAssign = useAuth((s) => s.can('issue:assign'));
  const canCreate = useAuth((s) => s.can('issue:create'));
  const canManageBoard = useAuth((s) => s.can('board:manage'));
  const canForceWip = useAuth((s) => s.can('project:admin') || s.can('workspace:admin'));
  const currentUserId = useAuth((s) => s.user?.id);
  const { active: quickFilters, toggle: toggleQuickFilter } = useQuickFilters();
  const [assignee, setAssignee] = useState('');
  const assigneeOptions = useAssigneeOptions(project?.id);
  const [dragging, setDragging] = useState<IssueDto | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Cột đầy WIP + người có quyền → hỏi "Vẫn chuyển?" (giữ nguyên biến để gửi lại kèm force).
  const [wipPrompt, setWipPrompt] = useState<{ vars: TransitionVars; col: BoardColumnDto; issueKey: string } | null>(null);
  const swimlaneBy: SwimlaneBy = board?.swimlaneBy ?? 'none';
  const activeSprintId = (sprintsQ.data ?? []).find((sp) => sp.state === 'ACTIVE')?.id ?? null;

  // Nhớ lọc người THEO DỰ ÁN (localStorage). Nạp khi đổi dự án.
  useEffect(() => {
    const pid = project?.id;
    if (!pid) return;
    try {
      const p = JSON.parse(localStorage.getItem(`tirapro:boardPrefs:${pid}`) || '{}');
      setAssignee(typeof p.assignee === 'string' ? p.assignee : '');
    } catch { setAssignee(''); }
  }, [project?.id]);
  const changeAssignee = (v: string) => {
    setAssignee(v);
    const pid = project?.id;
    if (!pid) return;
    try { localStorage.setItem(`tirapro:boardPrefs:${pid}`, JSON.stringify({ assignee: v })); } catch { /* ignore */ }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  // Lọc: bộ lọc nhanh (AND) + người phụ trách. Đếm cột/làn dựa trên tập này.
  const filteredIssues = useMemo(() => {
    const base = applyQuickFilters(issues ?? [], quickFilters, currentUserId);
    return applyAssigneeFilter(base, assignee);
  }, [issues, quickFilters, currentUserId, assignee]);

  const byColumn = useMemo(() => (board ? distribute(board, filteredIssues) : new Map<string, IssueDto[]>()), [board, filteredIssues]);

  // Làn (swimlane) theo cấu hình của bảng.
  const lanes = useMemo(() => buildLanes(swimlaneBy, filteredIssues, issues ?? []), [swimlaneBy, filteredIssues, issues]);

  const progressMap = useMemo(() => buildProgressMap(issues ?? []), [issues]);

  function onDragStart(e: DragStartEvent) {
    setDragging((issues ?? []).find((i) => i.id === e.active.id) ?? null);
  }

  /** Cột đầy WIP: người có quyền được hỏi "Vẫn chuyển?", người khác nhận lời nhắc rõ việc cần làm. */
  function onWipBlocked(err: unknown, vars: TransitionVars, col: BoardColumnDto, issueKey: string) {
    void apiErrorMessage(err); // đánh dấu đã xử lý → MutationCache không toast thêm lần hai
    if (canForceWip) setWipPrompt({ vars, col, issueKey });
    else toast.error(`Cột “${col.name}” đã đạt giới hạn ${col.wipLimit ?? ''} việc đang làm — hãy hoàn thành bớt việc trong cột này trước, hoặc nhờ quản trị dự án cho phép vượt giới hạn.`);
  }

  /** Chuyển trạng thái kèm Hoàn tác; `force` chỉ gửi khi người dùng đã xác nhận "Vẫn chuyển". */
  function runTransition(issue: IssueDto, col: BoardColumnDto, toStatusId: string, force = false) {
    if (!board) return;
    const fromStatusId = issue.status.id;
    const fromStatusName = issue.status.name;
    const vars: TransitionVars = { id: issue.id, toStatusId, version: issue.version, statusName: col.name, boardId: board.id, ...(force ? { force: true } : {}) };
    transition.mutate(vars, {
      onError: (err) => (isWipLimitError(err) ? onWipBlocked(err, vars, col, issue.key) : toast.error(apiErrorMessage(err))),
      onSuccess: (updated) =>
        toast.success(`Đã chuyển ${issue.key} sang “${col.name}”`, {
          duration: 4000,
          action: {
            label: 'Hoàn tác',
            onClick: () =>
              // Quay về cột cũ không làm cột đích đầy thêm nên không gửi boardId (không cần kiểm WIP).
              transition.mutate(
                { id: issue.id, toStatusId: fromStatusId, version: updated.version, statusName: fromStatusName },
                { onError: (err) => toast.error(apiErrorMessage(err)) },
              ),
          },
        }),
    });
  }

  function confirmForce() {
    if (!wipPrompt) return;
    const { vars, col, issueKey } = wipPrompt;
    setWipPrompt(null);
    transition.mutate({ ...vars, force: true }, {
      onError: (err) => toast.error(apiErrorMessage(err)),
      onSuccess: () => toast.success(`Đã chuyển ${issueKey} sang “${col.name}” (vượt giới hạn WIP)`, { duration: 4000 }),
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const issue = (issues ?? []).find((i) => i.id === e.active.id);
    // Droppable id = "laneKey::colId" (có swimlane) hoặc "colId" (phẳng).
    const overId = e.over ? String(e.over.id) : '';
    if (!issue || !overId) return;
    const grouped = overId.includes('::');
    const laneKey = grouped ? overId.split('::')[0]! : null;
    const colId = grouped ? overId.split('::')[1]! : overId;
    const col = board?.columns.find((c) => c.id === colId);
    // Cột chưa gắn trạng thái nào thì không có đích để chuyển tới.
    const targetStatusId = col?.statusIds[0];
    if (!col || !targetStatusId) return;

    const statusChanged = canTransition && !col.statusIds.includes(issue.status.id);

    // Thả sang làn khác chỉ có nghĩa "đổi người" khi bảng chia làn theo người; các kiểu chia khác chỉ đổi cột.
    const targetAssignee: string | null = laneKey === NO_LANE ? null : laneKey;
    const assigneeChanged = grouped && swimlaneBy === 'assignee' && canAssign && targetAssignee !== (issue.assigneeId ?? null);

    if (!assigneeChanged) {
      if (statusChanged) runTransition(issue, col, targetStatusId);
      return;
    }

    // Hàng theo người: thả sang hàng khác → đổi người phụ trách (hàng "Chưa có người phụ trách" = bỏ gán);
    // có thể kèm đổi trạng thái nếu thả sang cột khác.
    let version = issue.version;
    try {
      const updated = await updateIssue.mutateAsync({ id: issue.id, key: issue.key, patch: { assigneeId: targetAssignee }, version });
      version = updated.data.version;
    } catch (err) {
      toast.error(apiErrorMessage(err));
      return;
    }
    if (statusChanged && board) {
      const vars: TransitionVars = { id: issue.id, toStatusId: targetStatusId, version, statusName: col.name, boardId: board.id };
      try {
        await transition.mutateAsync(vars);
      } catch (err) {
        if (isWipLimitError(err)) {
          toast.success(`Đã giao ${issue.key} cho ${assigneeOptions.find((o) => o.id === targetAssignee)?.name ?? 'người khác'}`, { duration: 3000 });
          onWipBlocked(err, vars, col, issue.key);
        } else {
          toast.error(apiErrorMessage(err));
        }
        return;
      }
    }
    const who = targetAssignee == null ? 'bỏ người phụ trách' : `giao cho ${assigneeOptions.find((o) => o.id === targetAssignee)?.name ?? 'người khác'}`;
    const parts = [statusChanged ? `sang “${col.name}”` : '', `· ${who}`].filter(Boolean).join(' ');
    toast.success(`Đã cập nhật ${issue.key} ${parts}`.trim(), { duration: 3000 });
  }

  if (pe) {
    return <div className="p-6"><QueryError error={pErr} onRetry={() => refetchProject()} /></div>;
  }

  if (boardsQ.isError || projectIssuesQ.isError || (hasFilter && boardIssuesQ.isError)) {
    return (
      <div className="p-6">
        <QueryError
          error={boardsQ.error ?? projectIssuesQ.error ?? boardIssuesQ.error}
          onRetry={() => { void boardsQ.refetch(); void projectIssuesQ.refetch(); if (hasFilter) void boardIssuesQ.refetch(); }}
        />
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
    return (
      <div className="p-6">
        <EmptyState
          title="Chưa có bảng công việc"
          description="Bảng là nơi xem việc theo cột trạng thái và kéo thả để đổi trạng thái. Dự án này chưa có bảng nào — nhờ quản trị dự án tạo giúp trong phần Cấu hình."
        />
      </div>
    );
  }

  const openIssue = (k: string) => navigate(`/issue/${k}`);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3">
          <QuickFilterChips active={quickFilters} onToggle={toggleQuickFilter} />
          <AssigneeFilter options={assigneeOptions} value={assignee} onChange={changeAssignee} />
          {swimlaneBy !== 'none' && (
            <span
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-transparent bg-primary-subtle px-2.5 text-xs font-medium text-primary"
              title={swimlaneBy === 'assignee'
                ? 'Bảng đang chia hàng theo người phụ trách. Kéo việc sang hàng khác để giao cho người đó.'
                : `Bảng đang chia hàng: ${SWIMLANE_LABEL[swimlaneBy].toLowerCase()}.`}
            >
              <Layers className="h-3.5 w-3.5" /> {SWIMLANE_LABEL[swimlaneBy]}
            </span>
          )}
          {hasFilter && (
            <span
              className="inline-flex h-7 max-w-[18rem] items-center gap-1.5 truncate rounded-full border border-border px-2.5 text-xs text-muted"
              title={`Bảng chỉ hiện việc khớp bộ lọc: ${board.filterJql ?? ''}`}
            >
              Bộ lọc bảng: <span className="truncate font-mono">{board.filterJql}</span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <PresenceAvatars room="project" projectId={project?.id} />
            {canManageBoard && (
              <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)} title="Cột, giới hạn WIP, bộ lọc và cách chia hàng của bảng">
                <Settings className="h-4 w-4" /> Cài đặt bảng
              </Button>
            )}
          </div>
        </div>

        {lanes ? (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4">
            {lanes.length === 0 ? (
              <p className="py-10 text-center text-sm text-faint">Không có việc nào khớp bộ lọc. Tắt bớt bộ lọc phía trên để xem thêm.</p>
            ) : (
              lanes.map((lane, laneIdx) => {
                const laneCols = distribute(board, lane.issues);
                return (
                  <section key={lane.key}>
                    <div className="mb-2 flex items-center gap-2">
                      {lane.kind === 'assignee' ? (
                        lane.empty ? (
                          <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-faint"><UserRound className="h-3.5 w-3.5" /></span>
                        ) : (
                          <Avatar name={lane.name} src={lane.avatarUrl} size={24} />
                        )
                      ) : (
                        <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-2 text-faint"><Layers className="h-3.5 w-3.5" /></span>
                      )}
                      <span className="text-sm font-semibold text-ink-strong">{lane.name}</span>
                      <span
                        className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-muted"
                        title={`${lane.issues.length} việc đang hiển thị của ${lane.name}`}
                      >
                        {lane.issues.length}
                      </span>
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
                          wipUsed={wipCount(col, projectIssues ?? [], board, activeSprintId)}
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
                wipUsed={wipCount(col, projectIssues ?? [], board, activeSprintId)}
              />
            ))}
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>{dragging ? <Card issue={dragging} overlay /> : null}</DragOverlay>

      {settingsOpen && project?.id && (
        <BoardSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} projectId={project.id} board={board} />
      )}
      <ConfirmDialog
        open={!!wipPrompt}
        danger={false}
        title={`Cột “${wipPrompt?.col.name ?? ''}” đã đạt giới hạn WIP`}
        description={`Cột chỉ nên có tối đa ${wipPrompt?.col.wipLimit ?? ''} việc đang làm cùng lúc. Chuyển ${wipPrompt?.issueKey ?? 'việc này'} vào sẽ vượt giới hạn đó. Bạn vẫn muốn chuyển?`}
        confirmLabel="Vẫn chuyển"
        cancelLabel="Giữ nguyên"
        onConfirm={confirmForce}
        onCancel={() => setWipPrompt(null)}
      />
    </DndContext>
  );
}

function Column({
  col, issues, progressMap, onOpen, projectKey, projectId, canCreate, droppableId, laneIdx = 0, colIdx = 0, grouped = false, wipUsed = 0,
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
  /** Số việc tính vào WIP của cột (toàn bảng, chưa lọc) — chỉ dùng khi cột có giới hạn. */
  wipUsed?: number;
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
        <span className="tabular ml-auto text-xs text-muted" title={`${issues.length} việc đang hiển thị ở cột này`}>
          {issues.length}
        </span>
        {col.wipLimit != null && (
          <span
            className={cn(
              'tabular rounded-full px-1.5 py-px text-[11px] font-medium',
              wipUsed >= col.wipLimit ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-muted',
            )}
            title={wipUsed >= col.wipLimit
              ? `Cột đã đầy: ${wipUsed}/${col.wipLimit} việc đang làm. Hoàn thành bớt việc trước khi kéo thêm vào (quản trị dự án có thể chọn “Vẫn chuyển”).`
              : `Giới hạn việc đang làm (WIP): ${wipUsed}/${col.wipLimit}`}
          >
            WIP {wipUsed}/{col.wipLimit}
          </span>
        )}
      </div>
      <div className={cn('flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2', grouped && 'min-h-[3rem]')}>
        {issues.map((issue, rowIdx) => (
          <Card key={issue.id} issue={issue} progress={progressMap.get(issue.id)} onOpen={onOpen} laneIdx={laneIdx} colIdx={colIdx} rowIdx={rowIdx} />
        ))}
        {issues.length === 0 && <p className="px-2 py-6 text-center text-xs text-faint">Chưa có việc nào. Kéo việc vào đây hoặc thêm mới bên dưới.</p>}
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
      title={`Nhãn: ${name}`}
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
            <span
              className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-surface-2 px-1 text-[10px] font-medium text-muted"
              title={`${issue.storyPoints} điểm ước lượng — mức độ lớn của việc này`}
            >
              {issue.storyPoints}
            </span>
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
        <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted" title={`Mã công việc ${issue.key}`}>{issue.key}</span>
        {issue.priority && <span className="h-1.5 w-1.5 rounded-full" style={{ background: issue.priority.color ?? 'var(--faint)' }} title={`Mức ưu tiên: ${issue.priority.name}`} />}
        <div className="ml-auto flex min-w-0 items-center">
          {issue.assignee ? (
            <span className="flex min-w-0 items-center gap-1" title={`Người phụ trách: ${issue.assignee.displayName}`}>
              <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={18} />
              <span className="max-w-[6.5rem] truncate text-xs text-muted">{issue.assignee.displayName}</span>
            </span>
          ) : (
            <span className="whitespace-nowrap text-[11px] text-faint" title="Chưa có ai nhận việc này">Chưa gán</span>
          )}
        </div>
      </div>

      {progress && progress.total > 0 && (
        <div className="mt-2 flex items-center gap-1.5" title={`Việc con: đã xong ${progress.done}/${progress.total}`}>
          <TaskProgress progress={progress} compact className="flex-1" />
          <span className="tabular shrink-0 text-[10px] text-faint">{progress.done}/{progress.total}</span>
        </div>
      )}
    </div>
  );
}
