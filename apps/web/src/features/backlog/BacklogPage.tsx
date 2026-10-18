import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Plus,
  Play,
  CheckCircle2,
  ChevronRight,
  Inbox,
  Sparkles,
  Pencil,
  PanelLeftOpen,
} from 'lucide-react';
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual';
import type { SubtreeProgress } from '@/lib/issueTree';
import { useDragSensors } from '@/lib/dragSensors';
import { useOpenSession } from '@/lib/useOpenSession';
import { useRetained } from '@/lib/useRetained';
import {
  DndContext,
  DragOverlay,
  useDroppable,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import type { IssueDto, PriorityDto, SprintDto } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import {
  useProjectSprints,
  useCreateSprint,
  useStartSprint,
  useCompleteSprint,
  type MoveIncompleteTo,
} from './api';
import { CompleteSprintDialog } from './CompleteSprintDialog';
import { SprintEditDialog } from './SprintEditDialog';
import { StartSprintDialog, type StartSprintValues } from './StartSprintDialog';
import { parseSprintAction, stripSprintAction, type SprintAction } from './sprintAction';
import { useProjectIssues, useUpdateIssue } from '@/features/issues/api';
import { useProjectMeta } from '@/features/ai/api';
import { useProjectLabels, type ProjectLabel } from '@/features/issue-meta/api';
import { useWorkflows } from '@/features/workflow-settings/api';
import {
  applyEpicFilter,
  buildListProgressMap,
  epicChoices,
  epicCounts,
  parseEpicDropId,
  planEpicAssign,
} from '@/lib/epic';
import { TruncatedBanner } from '@/features/issues/TruncatedBanner';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { Button } from '@/components/ui/Button';
import { ToolbarStrip } from '@/components/ui/ToolbarStrip';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { exportIssuesCsvWithToast } from '@/features/export/api';
import { SprintTimeText } from '@/components/ui/SprintTimeText';
import { Input } from '@/components/ui/Input';
import { Badge, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { QuickAddRow } from '@/components/ui/QuickAddRow';
import { apiErrorMessage } from '@/lib/api';
import { activeDrag, useActiveDragId } from '@/lib/activeDrag';
import { dropContainer, useIsDropContainer } from '@/lib/dropContainer';
import { dropHint } from '@/lib/dropHint';
import { hintOf, placementFromDnd, type Placement } from '@/lib/rankDrop';
import { applyPendingOrder, sortByRank } from '@/lib/rankOrder';
import { epicAwareCollision, epicAwareKeyboardCoordinates } from '@/lib/sortableDnd';
import { useMoveIssue, usePendingMoves, type MoveVars } from '@/features/issues/moveIssue';
import { useAuth } from '@/stores/auth';
import {
  useCanEditIssue,
  useProjectCan,
  useProjectPermissions,
} from '@/features/projects/permissions';
import { cn } from '@/lib/utils';
import { CHIP_ROW_GAP_COARSE, CHIP_TOUCH_HIT, STRIP_ROWS_GAP_COARSE } from '@/lib/touchHit';
import { IssueRow, IssueRowBody, type RowEdit } from './IssueRow';
import { useBulkEdit } from './useBulkEdit';
import { commonNextStatuses } from './bulkEdit';
import {
  backlogDragRoute,
  canMoveSprintVia,
  neighborsIn,
  planBacklogDrop,
  widenNeighbors,
} from './dropPlan';
import { BulkActionBar } from './BulkActionBar';
import { EpicPanel } from './EpicPanel';
import { epicPanelShown, useEpicPanel } from '@/stores/epicPanel';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeekShell } from '@/features/issues/peek/PeekShell';
import { useIssuePeek } from '@/features/issues/peek/useIssuePeek';
import { SprintAssistantDialog } from '@/features/ai/SprintAssistantDialog';
import { QuickFilterChips } from '@/features/quick-filters/QuickFilterChips';
import { applyQuickFilters, useQuickFilters } from '@/features/quick-filters/useQuickFilters';
import { AssigneeFilter, applyAssigneeFilter } from '@/features/quick-filters/AssigneeFilter';
import { TERM } from '@/lib/terms';

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Nhấn Space để nhấc việc này lên. Khi đang nhấc, dùng mũi tên lên hoặc xuống để đổi thứ tự, tới sprint khác hoặc Việc chờ để chuyển, nhấn Space để thả, nhấn Esc để huỷ.',
};

/** id của droppable backlog (không phải sprint). */
const BACKLOG_ID = 'backlog';

const STATE_BADGE: Record<SprintDto['state'], { label: string; className: string }> = {
  ACTIVE: { label: 'Đang chạy', className: 'bg-primary-subtle text-primary' },
  FUTURE: { label: 'Chưa bắt đầu', className: 'bg-surface-2 text-muted' },
  CLOSED: { label: 'Đã kết thúc', className: 'bg-surface-2 text-faint' },
};

/** Giải nghĩa cho người mới: backlog và sprint là gì (hiện trong tooltip tiêu đề mỗi khu). */
const BACKLOG_TIP = 'Việc chờ: danh sách việc chưa xếp vào sprint nào.';
const SPRINT_TIP = 'Sprint: khoảng thời gian làm việc ngắn, thường 1–2 tuần.';

function pointsSum(issues: IssueDto[]): number {
  return issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
}

const NO_PRIORITIES: RowEdit['priorities'] = [];
const NO_LABELS: ProjectLabel[] = [];

export function BacklogPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const peek = useIssuePeek();
  const {
    data: project,
    isLoading: lp,
    isError: pe,
    error: pErr,
    refetch: refetchProject,
  } = useProject(key);
  const projectId = project?.id;

  const sprintsQ = useProjectSprints(projectId);
  const issuesQ = useProjectIssues(projectId);
  const { data: sprints, isLoading: ls } = sprintsQ;
  const { data: issues, isLoading: li } = issuesQ;

  const can = useProjectCan(project); // dự án lưu trữ: chỉ còn quyền đọc
  const canManageSprint = can('sprint:manage');
  const canManageBacklog = can('backlog:manage');
  const canCreate = can('issue:create');
  const canAssign = can('issue:assign');
  const canEditIssue = useCanEditIssue(projectId);
  // Sửa tại chỗ trên dòng (điểm/ưu tiên): callback + đối tượng ổn định để `IssueRow` (memo) không vẽ lại thừa.
  const { data: meta } = useProjectMeta(key);
  const patchIssue = useUpdateIssue(projectId);
  // `mutateAsync` (không phải `mutate`): callback của `mutate` chỉ chạy cho lần gọi MỚI NHẤT của cùng observer — sửa nhanh
  // hai dòng liền nhau sẽ làm dòng trước mất toast/Hoàn tác. Promise của từng lần gọi thì luôn chạy xong.
  const mutateIssue = patchIssue.mutateAsync;
  const onEditPoints = useCallback(
    (issue: IssueDto, value: number | null) =>
      void mutateIssue({
        id: issue.id,
        key: issue.key,
        patch: { storyPoints: value },
        version: issue.version,
      }).catch((e) => toast.error(apiErrorMessage(e))),
    [mutateIssue],
  );
  const onEditPriority = useCallback(
    (issue: IssueDto, priority: PriorityDto | null) =>
      void mutateIssue({
        id: issue.id,
        key: issue.key,
        patch: { priorityId: priority?.id ?? null },
        version: issue.version,
        optimistic: { priority },
      }).catch((e) => toast.error(apiErrorMessage(e))),
    [mutateIssue],
  );
  const rowEdit = useMemo<RowEdit>(
    () => ({
      priorities: meta?.priorities ?? NO_PRIORITIES,
      sprints,
      onEditPoints,
      onEditPriority,
    }),
    [meta?.priorities, sprints, onEditPoints, onEditPriority],
  );
  // Route kéo-thả theo guard của API (xem `backlogDragRoute`): rank = backlog:manage + issue:edit; move = issue:transition + (issue:edit | backlog:manage).
  const dragRoute = backlogDragRoute({
    backlogManage: canManageBacklog,
    editFull: can('issue:edit'),
    transition: can('issue:transition'),
  });
  const canDragIssue = useCallback(() => dragRoute !== null, [dragRoute]);
  const canUseAi = useAuth((s) => s.can('ai:use'));
  const currentUserId = useAuth((s) => s.user?.id);

  const createSprint = useCreateSprint(projectId ?? '');
  const startSprint = useStartSprint(projectId ?? '');
  const completeSprint = useCompleteSprint(projectId ?? '');
  const move = useMoveIssue(projectId ?? '');
  const pending = usePendingMoves(projectId);
  // Bộ lọc theo người: gồm cả tài khoản đã khoá (lọc được việc cũ của họ), tối đa 200 người.
  const assigneeOptions = useAssigneeOptions(projectId, { includeInactive: true, limit: 200 });

  // Bộ lọc nhanh (dùng chung với board) — áp client-side trong mỗi section.
  const { active: quickFilters, toggle: toggleQuickFilter } = useQuickFilters();
  const [assignee, setAssignee] = useState('');
  // Lọc theo epic ở panel trái: null = tất cả, 'none' = không thuộc epic, còn lại = id epic. State cục bộ (peek đã dùng URL).
  const [epicFilter, setEpicFilter] = useState<string | null>(null);
  // Trạng thái panel Epic dùng chung với rail dự án (mở panel → rail thu tạm, mở rail → panel thu).
  const epicPanelUserOpen = useEpicPanel((s) => s.open);
  const storeToggleEpicPanel = useEpicPanel((s) => s.toggle);
  // Xem nhanh mở ở khổ hẹp thì panel Epic tự thu tạm (không đổi lựa chọn đã lưu của người dùng).
  const squeezed = useMediaQuery('(min-width: 1024px) and (max-width: 1535px)');
  const epicPanelOpen = epicPanelShown(epicPanelUserOpen, peek.peekKey !== null, squeezed);
  const toggleEpicPanel = () => {
    // Đang bị thu tạm vì xem nhanh: người dùng bấm "Epic" = muốn xem Epic → đóng xem nhanh (mở cái này thì cái kia thu vào).
    if (epicPanelUserOpen && !epicPanelOpen) peek.close();
    else storeToggleEpicPanel();
  };

  // Bulk select: id các việc đang chọn + cờ đang chạy batch (khóa thao tác).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [dragging, setDragging] = useState<IssueDto | null>(null);
  // Phần tử cuộn của trang (dùng cho danh sách ảo hoá). Giữ bằng state để Section dài nhận được nó sau khi gắn DOM.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  // Sprint đang chờ xác nhận hoàn thành khi còn việc chưa xong.
  const [completing, setCompleting] = useState<{
    id: string;
    name: string;
    notDone: number;
  } | null>(null);
  const [assistantFor, setAssistantFor] = useState<{
    id: string;
    name: string;
    goal: string | null;
  } | null>(null);
  // Sprint đang mở hộp thoại sửa/xoá.
  const [editing, setEditing] = useState<SprintDto | null>(null);
  // Ba hộp thoại luôn mount (có hiệu ứng đóng): giữ đối tượng đích gần nhất + key theo lần mở (form khởi tạo lại).
  const assistantShown = useRetained(assistantFor);
  const assistantKey = useOpenSession(!!assistantFor);
  const completingShown = useRetained(completing);
  const completingKey = useOpenSession(!!completing);
  const editingShown = useRetained(editing);
  const editingKey = useOpenSession(!!editing);
  // Sprint đang chờ xác nhận Bắt đầu (hộp thoại sửa ngày/mục tiêu + cảnh báo thiếu).
  const [starting, setStarting] = useState<{ sprint: SprintDto; unestimated: number } | null>(null);
  const startingShown = useRetained(starting);
  const startingKey = useOpenSession(!!starting);

  const sensors = useDragSensors({ distance: 5, keyboard: epicAwareKeyboardCoordinates });

  // Sprint hiển thị: chỉ FUTURE/ACTIVE, ACTIVE trước rồi theo sequence.
  const visibleSprints = useMemo(() => {
    return (sprints ?? [])
      .filter((s) => s.state === 'ACTIVE' || s.state === 'FUTURE')
      .sort((a, b) => {
        if (a.state !== b.state) return a.state === 'ACTIVE' ? -1 : 1;
        return a.sequence - b.sequence;
      });
  }, [sprints]);

  const hasActive = useMemo(() => (sprints ?? []).some((s) => s.state === 'ACTIVE'), [sprints]);

  // Sprint đã đóng (chỉ để xem lại) — mới nhất trước.
  const closedSprints = useMemo(
    () =>
      (sprints ?? []).filter((s) => s.state === 'CLOSED').sort((a, b) => b.sequence - a.sequence),
    [sprints],
  );

  // Mỗi khu theo rank CHƯA lọc (+ các lần kéo đang chờ, lạc quan, không tự tính rank). Mốc kéo-thả phải tính trên danh sách này
  // để việc thả xuống sát mốc đang thấy dù quanh đó có việc bị ẩn bởi bộ lọc.
  const fullBySprint = useMemo(() => {
    const map = new Map<string, IssueDto[]>();
    map.set(BACKLOG_ID, []);
    for (const s of visibleSprints) map.set(s.id, []);
    for (const s of closedSprints) map.set(s.id, []);
    for (const issue of issues ?? []) {
      // Việc thuộc sprint không nằm trong danh sách → bỏ qua (an toàn).
      if (issue.sprintId && !map.has(issue.sprintId)) continue;
      map.get(issue.sprintId ?? BACKLOG_ID)!.push(issue);
    }
    for (const [k, list] of map) map.set(k, applyPendingOrder(sortByRank(list), pending));
    return map;
  }, [visibleSprints, closedSprints, issues, pending]);

  const byIdAll = useMemo(() => new Map((issues ?? []).map((i) => [i.id, i])), [issues]);
  const epics = useMemo(() => epicChoices(issues ?? [], ''), [issues]);
  const counts = useMemo(() => epicCounts(issues ?? []), [issues]);
  // Epic đang chọn không còn (xoá/đổi loại) → về "Tất cả".
  useEffect(() => {
    if (epicFilter && epicFilter !== 'none' && !epics.some((e) => e.id === epicFilter))
      setEpicFilter(null);
  }, [epicFilter, epics]);

  // Công việc sau khi áp bộ lọc nhanh + người phụ trách + epic — chia vào từng khu (số đếm phản ánh tập đã lọc).
  const bySprint = useMemo(() => {
    const map = new Map<string, IssueDto[]>();
    for (const [k, list] of fullBySprint)
      map.set(
        k,
        applyEpicFilter(
          applyAssigneeFilter(applyQuickFilters(list, quickFilters, currentUserId), assignee),
          epicFilter,
          byIdAll,
        ),
      );
    return map;
  }, [fullBySprint, quickFilters, currentUserId, assignee, epicFilter, byIdAll]);
  // Thêm nhanh khi đang lọc một epic → việc mới gắn luôn epic đó.
  const quickAddEpicId = epicFilter && epicFilter !== 'none' ? epicFilter : undefined;

  const progressMap = useMemo(() => buildListProgressMap(issues ?? []), [issues]);

  function onDragStart(e: DragStartEvent) {
    activeDrag.set(String(e.active.id));
    setDragging((issues ?? []).find((i) => i.id === e.active.id) ?? null);
  }

  function labelForSprint(id: string | null): string {
    if (id === null) return TERM.backlog;
    return (sprints ?? []).find((s) => s.id === id)?.name ?? 'sprint khác';
  }

  // Thả dòng lên mục panel Epic: gắn/gỡ epic bằng PATCH (không đi rank/move → không đổi vị trí hay sprint của dòng) + Hoàn tác.
  function assignToEpic(issue: IssueDto, target: string) {
    if (!canEditIssue(issue)) {
      toast.info('Bạn không có quyền sửa công việc này.');
      return;
    }
    const plan = planEpicAssign(issue, target, byIdAll);
    if (plan.kind === 'ignore') return;
    if (plan.kind === 'reject') {
      toast.info(plan.reason);
      return;
    }
    const epicKey = byIdAll.get(target)?.key;
    void mutateIssue({
      id: issue.id,
      key: issue.key,
      patch: plan.patch,
      version: issue.version,
    }).then(
      (res) =>
        toast.success(
          target === 'none' ? `Đã gỡ ${issue.key} khỏi epic` : `Đã gắn ${issue.key} vào ${epicKey}`,
          {
            duration: 5000,
            action: {
              label: 'Hoàn tác',
              onClick: () =>
                void mutateIssue({
                  id: issue.id,
                  key: issue.key,
                  patch: plan.restore,
                  version: res.data.version,
                }).catch((err) => toast.error(apiErrorMessage(err))),
            },
          },
        ),
      (err) => toast.error(apiErrorMessage(err)),
    );
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    clearDragFeedback();
    const issue = (issues ?? []).find((i) => i.id === e.active.id);
    const epicTarget = e.over ? parseEpicDropId(String(e.over.id)) : null;
    if (epicTarget) {
      if (issue) assignToEpic(issue, epicTarget);
      return;
    }
    const p = placementFromDnd(e);
    if (!issue || !p || !dragRoute) return;
    const plan = planBacklogDrop(issue, p, BACKLOG_ID);
    if (plan.ignore) return;
    const { targetSprintId, sprintChanged } = plan;
    if (sprintChanged && !canMoveSprintVia(dragRoute, canEditIssue(issue))) {
      toast.info(
        'Bạn không có quyền đổi sprint của việc này — chỉ đổi được thứ tự trong cùng khu.',
      );
      return;
    }
    const currentSprintId = issue.sprintId ?? null;
    // Mốc theo danh sách CHƯA lọc của khu đích (xem `widenNeighbors`); chỗ cũ (Hoàn tác) = láng giềng thật ở khu cũ.
    const idsOf = (container: string) => (fullBySprint.get(container) ?? []).map((i) => i.id);
    const { afterId, beforeId } = widenNeighbors(idsOf(p.containerId), p, issue.id);
    const origin = neighborsIn(idsOf(currentSprintId ?? BACKLOG_ID), issue.id);
    // Route theo quyền (`dragRoute`: 'rank' hoặc 'move', cùng nhận sprintId + hai mốc); một request vừa đổi sprint vừa chèn đúng chỗ.
    const vars: MoveVars = {
      route: dragRoute,
      id: issue.id,
      key: issue.key,
      version: issue.version,
      afterId,
      beforeId,
      ...(sprintChanged ? { sprintId: targetSprintId } : {}),
    };
    try {
      const updated = await move.mutateAsync(vars);
      toast.success(
        sprintChanged
          ? `Đã chuyển ${issue.key} sang ${labelForSprint(targetSprintId)}`
          : `Đã đổi thứ tự ${issue.key}`,
        {
          duration: 4000,
          action: {
            label: 'Hoàn tác',
            // Đưa về sprint cũ + hai mốc cũ, dùng version máy chủ vừa trả về.
            onClick: () =>
              void move
                .mutateAsync({
                  route: dragRoute,
                  id: issue.id,
                  key: issue.key,
                  version: updated.version,
                  afterId: origin.afterId,
                  beforeId: origin.beforeId,
                  ...(sprintChanged ? { sprintId: currentSprintId } : {}),
                })
                .catch(() => undefined),
          },
        },
      );
    } catch {
      /* hook + MutationCache đã báo (409 mốc cũ → toast nhẹ + nạp lại) */
    }
  }

  // Trang rời đi (DndContext unmount) giữa lúc kéo: không để lại đường kẻ chèn của lần kéo dở.
  useEffect(() => clearDragFeedback, []);
  // Vạch chèn + viền khu đích đi qua store nhỏ (không qua `useDndContext`, vốn đổi mỗi nhịp con trỏ và vẽ lại mọi khu).
  const onDragMove = (e: DragMoveEvent) => {
    // Đang rê trên panel Epic: không phải sắp xếp/đổi sprint → bỏ vạch chèn và viền khu.
    if (e.over && parseEpicDropId(String(e.over.id))) {
      dropHint.set(null);
      dropContainer.set(null);
      return;
    }
    const p = placementFromDnd(e);
    dropHint.set(hintOf(p));
    dropContainer.set(p?.crossContainer ? p.containerId : null);
  };
  const onDragCancel = () => {
    setDragging(null);
    clearDragFeedback();
  };

  const announcements = useMemo<Announcements>(() => {
    const keyOf = (id: string | number) => (issues ?? []).find((i) => i.id === id)?.key ?? 'Việc';
    const whereOf = (containerId: string) =>
      containerId === BACKLOG_ID
        ? TERM.backlog
        : `sprint “${(sprints ?? []).find((s) => s.id === containerId)?.name ?? 'khác'}”`;
    const at = (p: Placement) => `vị trí ${p.index + 1}/${p.total}`;
    // Mục panel Epic đang rê/thả: 'none' = bỏ khỏi epic, còn lại = tên epic, null = không phải panel Epic.
    const epicTargetOf = (over: { id: string | number } | null) => {
      const t = over ? parseEpicDropId(String(over.id)) : null;
      if (t === null) return null;
      return t === 'none' ? 'none' : `epic ${keyOf(t)}`;
    };
    const overText = (e: Parameters<NonNullable<Announcements['onDragOver']>>[0]) => {
      const et = epicTargetOf(e.over);
      if (et)
        return et === 'none'
          ? `${keyOf(e.active.id)} trên mục Không thuộc epic — thả để gỡ khỏi epic.`
          : `${keyOf(e.active.id)} trên ${et} — thả để gắn vào epic.`;
      const p = placementFromDnd(e);
      if (!p) return `${keyOf(e.active.id)} đang ở ngoài các danh sách.`;
      return p.crossContainer
        ? `${keyOf(e.active.id)} sang ${whereOf(p.containerId)}, ${at(p)}.`
        : `${keyOf(e.active.id)} ở ${at(p)} trong ${whereOf(p.containerId)}.`;
    };
    return {
      onDragStart: ({ active }) => {
        const s = active.data.current?.sortable as
          | { containerId: string; index: number; items: unknown[] }
          | undefined;
        return `Đã nhấc ${keyOf(active.id)}${
          s ? ` ở ${whereOf(String(s.containerId))}, vị trí ${s.index + 1}/${s.items.length}` : ''
        }. Mũi tên lên xuống đổi thứ tự, tới sprint khác để chuyển sprint, tới panel Epic để gắn epic, Space để thả, Esc để huỷ.`;
      },
      onDragOver: overText,
      // Cùng câu với onDragOver: vị trí đổi (nửa trên/dưới của dòng đích) mà `over` không đổi vẫn được đọc đúng.
      onDragMove: overText,
      onDragEnd: (e) => {
        const et = epicTargetOf(e.over);
        if (et)
          return et === 'none'
            ? `Đã thả ${keyOf(e.active.id)} vào Không thuộc epic — gỡ khỏi epic.`
            : `Đã thả ${keyOf(e.active.id)} vào ${et} — gắn vào epic.`;
        const p = placementFromDnd(e);
        if (!p) return `Đã thả ${keyOf(e.active.id)} ra ngoài các danh sách, giữ nguyên.`;
        if (p.unchanged)
          return `Đã thả ${keyOf(e.active.id)}, giữ nguyên ${at(p)} trong ${whereOf(p.containerId)}.`;
        return p.crossContainer
          ? `Đã thả ${keyOf(e.active.id)} vào ${whereOf(p.containerId)}, ${at(p)}.`
          : `Đã thả ${keyOf(e.active.id)} ở ${at(p)} trong ${whereOf(p.containerId)}.`;
      },
      onDragCancel: ({ active }) => `Đã huỷ kéo ${keyOf(active.id)}, giữ nguyên vị trí.`,
    };
  }, [issues, sprints]);

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    createSprint.mutate(
      { name },
      {
        onSuccess: () => {
          setNewName('');
          setCreating(false);
          toast.success(`Đã tạo sprint “${name}”. Kéo việc từ Việc chờ vào để xếp lịch.`);
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  /* -------------------------- Bulk select -------------------------- */

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Chọn/bỏ chọn toàn bộ việc (đã lọc) trong một section.
  const toggleSelectSection = useCallback((ids: string[], selectAll: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selectAll) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Thao tác hàng loạt (Gán/Chuyển sprint/Điểm/Ưu tiên/Nhãn/Epic/Trạng thái) + Hoàn tác — xem `useBulkEdit`.
  const { data: workflows } = useWorkflows();
  const { data: projectLabels } = useProjectLabels(projectId);
  const bulk = useBulkEdit({
    projectId: projectId ?? '',
    issues,
    selected,
    clearSelection,
    workflows,
    sprints,
  });
  const selectedIssues = useMemo(
    () => (issues ?? []).filter((i) => selected.has(i.id)),
    [issues, selected],
  );
  const canEditAll = selectedIssues.every(canEditIssue); // điểm cùng điều kiện với ưu tiên/nhãn/epic (B7)
  const statusOptions = useMemo(
    () => commonNextStatuses(workflows, selectedIssues),
    [workflows, selectedIssues],
  );
  // Epic chọn được: loại chính các việc đang chọn (máy chủ 422 nếu epic nằm trong lô).
  const epicOptions = useMemo(
    () => epicChoices(issues ?? [], '').filter((e) => !selected.has(e.id)),
    [issues, selected],
  );

  // Lệnh sprint từ Cmd+K (`?action=create-sprint|start|complete[&sprint=ID]`, xem `sprintAction.ts`): chờ dữ liệu tải xong
  // rồi chạy ĐÚNG luồng của nút tương ứng, xoá tham số khỏi URL. `handledAction` chặn chạy lại (StrictMode, render lại).
  const { search } = useLocation();
  const runSprintActionRef = useRef<((a: SprintAction) => void) | null>(null);
  const handledAction = useRef<string | null>(null);
  // Quyền đã tải (không thì `canManageSprint` = false → báo "không có quyền" giả) và không rơi vào nhánh lỗi tải.
  const permsLoaded = !useProjectPermissions(projectId).isPending;
  const actionReady =
    !!projectId &&
    permsLoaded &&
    !pe &&
    !ls &&
    !li &&
    !sprintsQ.isFetching &&
    !issuesQ.isFetching &&
    !sprintsQ.isError &&
    !issuesQ.isError;
  useEffect(() => {
    const a = parseSprintAction(search);
    if (!a) {
      handledAction.current = null;
      return;
    }
    if (!actionReady || handledAction.current === search) return;
    handledAction.current = search;
    runSprintActionRef.current?.(a);
    navigate({ search: stripSprintAction(search) }, { replace: true });
  }, [search, actionReady, navigate]);

  if (pe) {
    return (
      <div className="p-6">
        <QueryError error={pErr} onRetry={() => refetchProject()} />
      </div>
    );
  }

  if (sprintsQ.isError || issuesQ.isError) {
    return (
      <div className="p-6">
        <QueryError
          error={sprintsQ.error ?? issuesQ.error}
          onRetry={() => {
            void sprintsQ.refetch();
            void issuesQ.refetch();
          }}
        />
      </div>
    );
  }

  if (lp || !projectId || ls || li) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-9 w-48" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
        <DelayedSpinner />
      </div>
    );
  }

  const backlogIssues = bySprint.get(BACKLOG_ID) ?? [];

  // Mở hộp xác nhận Bắt đầu sprint — MỘT lối vào dùng cho nút và các lệnh khác (vd Cmd+K `?action=start`).
  // Không gọi API trực tiếp: BE chưa có endpoint "huỷ bắt đầu" nên hộp xác nhận là lưới an toàn.
  function openStartDialog(sprintId: string) {
    const sprint = sprints?.find((s) => s.id === sprintId);
    if (!sprint || sprint.state !== 'FUTURE') return;
    // Đếm trên danh sách CHƯA lọc (như requestComplete): bộ lọc nhanh đang bật không được làm sai cảnh báo.
    const unestimated = (fullBySprint.get(sprintId) ?? []).filter(
      (i) => i.storyPoints == null,
    ).length;
    setStarting({ sprint, unestimated });
  }

  // Kết thúc sprint — MỘT lối vào cho nút và lệnh Cmd+K: còn việc chưa xong → hỏi chuyển đi đâu; xong hết → kết thúc luôn.
  // Đếm trên danh sách CHƯA lọc: bộ lọc nhanh đang bật không được làm lọt việc chưa xong khỏi hộp xác nhận.
  function requestComplete(sprint: { id: string; name: string }) {
    const notDone = (fullBySprint.get(sprint.id) ?? []).filter(
      (i) => i.status.category !== 'DONE',
    ).length;
    if (notDone > 0) {
      setCompleting({ id: sprint.id, name: sprint.name, notDone });
      return;
    }
    completeSprint.mutate(
      { sprintId: sprint.id },
      {
        onSuccess: () => {
          toast.success(`Đã kết thúc sprint “${sprint.name}”`);
          showSprintSummary(sprint.id);
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  // Lệnh sprint từ URL: cùng quyền và cùng điều kiện với các nút (không bày lệnh mà API sẽ từ chối).
  runSprintActionRef.current = (a) => {
    if (!canManageSprint) {
      toast.info('Bạn không có quyền quản lý sprint của dự án này.');
      return;
    }
    if (a.action === 'create-sprint') {
      setCreating(true);
      return;
    }
    const sprint = sprints?.find((sp) => sp.id === a.sprintId);
    if (a.action === 'start') {
      if (!sprint || sprint.state !== 'FUTURE')
        toast.info('Sprint này không còn ở trạng thái chờ bắt đầu.');
      else if (hasActive)
        toast.info('Đang có sprint chạy — hãy kết thúc sprint đó trước khi bắt đầu sprint mới.');
      else openStartDialog(sprint.id);
      return;
    }
    if (!sprint || sprint.state !== 'ACTIVE') {
      toast.info('Sprint này không còn đang chạy.');
      return;
    }
    requestComplete(sprint);
  };

  function confirmStart(values: StartSprintValues) {
    if (!starting) return;
    const { id, name } = starting.sprint;
    startSprint.mutate(
      { sprintId: id, ...values },
      {
        onSuccess: () => {
          setStarting(null);
          toast.success(`Đã bắt đầu sprint “${name}”`);
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  // Sau khi kết thúc sprint: sang trang tổng kết đúng sprint đó (x/y điểm, việc chuyển tiếp, so velocity TB).
  function showSprintSummary(sprintId: string) {
    navigate(`/p/${key}/reports?tab=sprint&sprint=${sprintId}`);
  }

  // Xác nhận hoàn thành sprint còn việc chưa xong; người dùng chọn việc chưa xong đi đâu.
  function confirmComplete(moveIncompleteTo: MoveIncompleteTo) {
    if (!completing) return;
    const { id, name, notDone } = completing;
    setCompleting(null);
    const where =
      moveIncompleteTo === 'backlog'
        ? 'quay về Việc chờ'
        : moveIncompleteTo === 'new'
          ? 'đã chuyển sang sprint mới'
          : `đã chuyển sang “${labelForSprint(moveIncompleteTo.sprintId)}”`;
    completeSprint.mutate(
      { sprintId: id, moveIncompleteTo },
      {
        onSuccess: () => {
          toast.success(
            notDone > 0
              ? `Đã kết thúc sprint “${name}”. ${notDone} việc chưa xong ${where}.`
              : `Đã kết thúc sprint “${name}”`,
          );
          showSprintSummary(id);
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  const createSprintButton = (visibility: string) => (
    <Button
      size="sm"
      variant="secondary"
      title={`Tạo một sprint mới. ${SPRINT_TIP}`}
      onClick={() => setCreating(true)}
      className={cn(CHIP_TOUCH_HIT, visibility)}
    >
      <Plus className="h-4 w-4" />
      Tạo sprint
    </Button>
  );

  return (
    <PeekShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <TruncatedBanner projectId={projectId} />
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6',
            CHIP_ROW_GAP_COARSE,
            // Mobile: hai dải cuộn ngang (chip nhanh + điều khiển phụ) → bỏ khoảng hở hàng (xem STRIP_ROWS_GAP_COARSE).
            STRIP_ROWS_GAP_COARSE,
          )}
        >
          {!epicPanelOpen && (
            <Button
              size="sm"
              variant="secondary"
              className="hidden lg:inline-flex"
              title="Mở panel Epic"
              onClick={toggleEpicPanel}
            >
              <PanelLeftOpen className="h-4 w-4" />
              Epic
            </Button>
          )}
          <QuickFilterChips active={quickFilters} onToggle={toggleQuickFilter} />
          <ToolbarStrip ariaLabel="Điều khiển danh sách">
            {/* Mobile: hành động chính "Tạo sprint" đứng ĐẦU dải (thấy ngay, không cần cuộn); từ sm nút nằm bên phải như cũ.
                Hai bản, mỗi bản ẩn ở cỡ kia (display: none → không nhận Tab) nên thứ tự Tab = thứ tự hiển thị. */}
            {canManageSprint && !creating && createSprintButton('sm:hidden')}
            {/* `sm:order-[-1]`: từ sm trở lên ô epic vẫn đứng TRƯỚC hàng chip như trước khi gom dải. */}
            <div className="w-44 shrink-0 sm:order-[-1] lg:hidden">
              <SearchSelect
                ariaLabel="Lọc theo epic"
                value={epicFilter ?? ''}
                onChange={(v) => setEpicFilter(v || null)}
                options={[
                  { value: '', label: 'Epic: Tất cả việc' },
                  { value: 'none', label: 'Không thuộc epic' },
                  ...epics.map((e) => ({ value: e.id, label: e.summary, hint: e.key })),
                ]}
                searchPlaceholder="Tìm epic theo mã hoặc tiêu đề…"
                className={cn('h-8', CHIP_TOUCH_HIT)}
              />
            </div>
            <AssigneeFilter options={assigneeOptions} value={assignee} onChange={setAssignee} />
            {/* Mobile: `contents` → Xuất và Tạo sprint là mục của dải cuộn. */}
            <div className="contents sm:ml-auto sm:flex sm:flex-nowrap sm:items-center sm:gap-2">
              <ExportMenu
                className={CHIP_TOUCH_HIT}
                items={[
                  {
                    id: 'backlog',
                    label: 'Việc chờ (CSV)',
                    hint: 'Việc chưa xong và chưa vào sprint',
                    run: () => exportIssuesCsvWithToast({ projectId, preset: 'backlog' }),
                  },
                  {
                    id: 'bugs',
                    label: 'Danh sách bug (CSV)',
                    hint: 'Mọi công việc loại Bug của dự án',
                    run: () => exportIssuesCsvWithToast({ projectId, preset: 'bugs' }),
                  },
                ]}
              />
              {canManageSprint && !creating && createSprintButton('max-sm:hidden')}
            </div>
          </ToolbarStrip>
          {canManageSprint && creating && (
            <form
              className="flex w-full items-center gap-2 sm:w-auto"
              onSubmit={(e) => {
                e.preventDefault();
                handleCreate();
              }}
            >
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewName('');
                  }
                }}
                placeholder="VD: Sprint 1 — tuần 1 và 2"
                className="h-8 min-w-0 flex-1 sm:w-56 sm:flex-none"
                aria-label="Tên sprint mới"
                title={SPRINT_TIP}
              />
              <Button
                type="submit"
                size="sm"
                loading={createSprint.isPending}
                disabled={!newName.trim()}
              >
                Tạo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                }}
              >
                Hủy
              </Button>
            </form>
          )}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={epicAwareCollision}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={(e) => void onDragEnd(e)}
          onDragCancel={onDragCancel}
          accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
        >
          <div className="flex min-h-0 flex-1">
            <EpicPanel
              epics={epics}
              issues={issues ?? []}
              counts={counts}
              selected={epicFilter}
              onSelect={setEpicFilter}
              // Không có quyền sửa việc đang kéo → mục epic không nhận thả (không sáng viền gợi ý rồi mới từ chối).
              dropEnabled={dragRoute !== null && (!dragging || canEditIssue(dragging))}
              collapsed={!epicPanelOpen}
              onToggle={toggleEpicPanel}
            />
            <div
              ref={setScrollEl}
              // Xem nhanh mở → cột danh sách hẹp lại: dòng ẩn nhãn + tên người phụ trách (xem `group-data-[peeking]/list` ở IssueRow).
              data-peeking={peek.peekKey ? '' : undefined}
              // Đệm đáy `pb-24` chừa chỗ cho nút nổi — chỉ từ `lg` (dưới `lg` không có nút nổi, thanh tab đáy nằm NGOÀI vùng cuộn).
              // Không đệm đáy dưới `lg`: `BulkActionBar` là `sticky bottom-0` và tính theo mép đệm → đệm lớn sẽ nâng nó lơ lửng giữa danh sách.
              className="group/list min-w-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-6 lg:pb-24"
            >
              {visibleSprints.map((sprint, sprintIdx) => {
                const sprintIssues = bySprint.get(sprint.id) ?? [];
                // Chưa lọc: cùng số với hộp xác nhận Kết thúc sprint và lệnh Cmd+K.
                const notDone = (fullBySprint.get(sprint.id) ?? []).filter(
                  (i) => i.status.category !== 'DONE',
                ).length;
                return (
                  <div key={sprint.id} data-tour={sprintIdx === 0 ? 'backlog-sprint' : undefined}>
                    <Section
                      id={sprint.id}
                      title={sprint.name}
                      badge={STATE_BADGE[sprint.state]}
                      meta={
                        sprint.state === 'ACTIVE' ? (
                          <SprintTimeText sprint={sprint} className="text-xs" />
                        ) : undefined
                      }
                      points={pointsSum(sprintIssues)}
                      count={sprintIssues.length}
                      issues={sprintIssues}
                      progressMap={progressMap}
                      scrollEl={scrollEl}
                      projectKey={key}
                      projectId={projectId}
                      canCreate={canCreate}
                      quickAddSprintId={sprint.state !== 'CLOSED' ? sprint.id : undefined}
                      quickAddEpicId={quickAddEpicId}
                      selectable={canAssign || canManageBacklog}
                      canDrag={canDragIssue}
                      rowEdit={rowEdit}
                      canEditRow={canEditIssue}
                      selected={selected}
                      onToggleSelect={toggleSelect}
                      onToggleSection={toggleSelectSection}
                      onOpen={peek.open}
                      peekedKey={peek.peekKey}
                      action={
                        canManageSprint ? (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={`Sửa sprint ${sprint.name}`}
                              title={
                                sprint.state === 'FUTURE'
                                  ? 'Sửa tên, mục tiêu, ngày — hoặc xoá sprint'
                                  : 'Sửa mục tiêu và ngày kết thúc'
                              }
                              onClick={() => setEditing(sprint)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {sprint.state === 'FUTURE' ? (
                              <>
                                {canUseAi && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    title="Gợi ý việc trong Việc chờ vừa với năng lực của đội"
                                    aria-label="Trợ lý lập sprint"
                                    onClick={() =>
                                      setAssistantFor({
                                        id: sprint.id,
                                        name: sprint.name,
                                        goal: sprint.goal ?? null,
                                      })
                                    }
                                  >
                                    <Sparkles className="h-4 w-4" />
                                    <span className="hidden sm:inline">Trợ lý lập sprint</span>
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  title={`Bắt đầu sprint này. ${SPRINT_TIP}`}
                                  onClick={() => openStartDialog(sprint.id)}
                                >
                                  <Play className="h-4 w-4" />
                                  Bắt đầu sprint
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                title="Kết thúc sprint này. Bạn chọn việc chưa xong đi đâu: Việc chờ, sprint mới hoặc sprint có sẵn."
                                loading={
                                  completeSprint.isPending &&
                                  completeSprint.variables?.sprintId === sprint.id
                                }
                                onClick={() => requestComplete(sprint)}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                Kết thúc sprint
                              </Button>
                            )}
                          </div>
                        ) : undefined
                      }
                      hint={
                        sprint.state === 'FUTURE'
                          ? hasActive
                            ? 'Đang có một sprint chạy dở — kết thúc sprint đó trước rồi mới bắt đầu sprint này.'
                            : sprint.goal
                          : notDone > 0
                            ? `Còn ${notDone} việc chưa xong. Khi kết thúc sprint, bạn chọn đưa chúng về Việc chờ hoặc sang sprint khác.`
                            : sprint.goal
                      }
                    />
                  </div>
                );
              })}

              <Section
                id={BACKLOG_ID}
                title={TERM.backlog}
                badge={null}
                points={pointsSum(backlogIssues)}
                count={backlogIssues.length}
                issues={backlogIssues}
                progressMap={progressMap}
                scrollEl={scrollEl}
                projectKey={key}
                projectId={projectId}
                canCreate={canCreate}
                quickAddSprintId={null}
                quickAddEpicId={quickAddEpicId}
                selectable={canAssign || canManageBacklog}
                canDrag={canDragIssue}
                rowEdit={rowEdit}
                canEditRow={canEditIssue}
                selected={selected}
                onToggleSelect={toggleSelect}
                onToggleSection={toggleSelectSection}
                onOpen={peek.open}
                peekedKey={peek.peekKey}
                emptyTitle="Việc chờ đang trống"
                emptyDescription="Đây là nơi chứa việc chưa xếp vào sprint nào. Thêm việc ở ô bên dưới, hoặc kéo việc từ sprint về đây."
              />

              {/* Sprint đã kết thúc — xem lại (chỉ đọc) */}
              {closedSprints.length > 0 && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowClosed((v) => !v)}
                    aria-expanded={showClosed}
                    title="Các sprint đã kết thúc — chỉ xem lại, không sửa được."
                    className="flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <ChevronRight
                      className={cn('h-4 w-4 transition-transform', showClosed && 'rotate-90')}
                    />
                    Sprint đã kết thúc ({closedSprints.length})
                  </button>
                  {showClosed && (
                    <div className="mt-3 space-y-4">
                      {closedSprints.map((sprint) => {
                        const sprintIssues = bySprint.get(sprint.id) ?? [];
                        return (
                          <Section
                            key={sprint.id}
                            id={sprint.id}
                            title={sprint.name}
                            badge={STATE_BADGE.CLOSED}
                            points={pointsSum(sprintIssues)}
                            count={sprintIssues.length}
                            issues={sprintIssues}
                            progressMap={progressMap}
                            scrollEl={scrollEl}
                            readOnly
                            hint={sprint.goal}
                            onOpen={peek.open}
                            peekedKey={peek.peekKey}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {selected.size > 0 && (
                <BulkActionBar
                  count={selected.size}
                  projectId={projectId}
                  sprints={visibleSprints}
                  busy={bulk.busy}
                  canAssign={canAssign}
                  canManageBacklog={canManageBacklog}
                  onAssignToMe={() => {
                    if (currentUserId) void bulk.assign(currentUserId);
                  }}
                  onAssignTo={(userId) => void bulk.assign(userId)}
                  onMoveToSprint={(sprintId) => void bulk.moveToSprint(sprintId)}
                  onClear={clearSelection}
                  canEdit={canEditAll}
                  canTransition={can('issue:transition')}
                  priorities={meta?.priorities ?? NO_PRIORITIES}
                  epics={epicOptions}
                  labels={projectLabels ?? NO_LABELS}
                  statusOptions={statusOptions}
                  onSetPoints={(points) => void bulk.setPoints(points)}
                  onSetPriority={(id) => void bulk.setPriority(id)}
                  onAddLabel={(id) => void bulk.addLabel(id)}
                  onSetEpic={(id) => void bulk.setEpic(id)}
                  onSetStatus={(id) => void bulk.setStatus(id)}
                />
              )}
            </div>
          </div>

          <DragOverlay>{dragging ? <IssueRowBody issue={dragging} overlay /> : null}</DragOverlay>
        </DndContext>

        {assistantShown && projectId && (
          <SprintAssistantDialog
            key={assistantKey}
            open={!!assistantFor}
            projectId={projectId}
            sprint={assistantShown}
            onClose={() => setAssistantFor(null)}
          />
        )}

        {completingShown && (
          <CompleteSprintDialog
            key={completingKey}
            open={!!completing}
            name={completingShown.name}
            notDone={completingShown.notDone}
            futureSprints={visibleSprints.filter((sp) => sp.state === 'FUTURE')}
            loading={completeSprint.isPending}
            onConfirm={confirmComplete}
            onCancel={() => setCompleting(null)}
          />
        )}
        {startingShown && (
          <StartSprintDialog
            key={startingKey}
            open={!!starting}
            sprint={startingShown.sprint}
            unestimatedCount={startingShown.unestimated}
            loading={startSprint.isPending}
            onConfirm={confirmStart}
            onCancel={() => setStarting(null)}
          />
        )}
        {editingShown && projectId && (
          <SprintEditDialog
            key={editingKey}
            open={!!editing}
            sprint={editingShown}
            projectId={projectId}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </PeekShell>
  );
}

/** Dọn mọi phản hồi kéo-thả toàn cục (vạch chèn, viền khu đích, id việc đang kéo). */
function clearDragFeedback() {
  dropHint.set(null);
  dropContainer.set(null);
  activeDrag.set(null);
}

/** Danh sách dài hơn ngưỡng này thì chỉ vẽ các dòng đang trong khung nhìn. */
const VIRTUALIZE_AFTER = 50;
const ROW_ESTIMATE = 40;
const ROW_GAP = 6;

/**
 * Danh sách ảo hoá cuộn theo phần tử cuộn của TRANG (không tạo thanh cuộn lồng nhau). Dòng đang kéo và dòng đang
 * giữ focus luôn được giữ trong DOM để kéo-thả và bàn phím không bị ngắt khi cuộn.
 */
function VirtualRows({
  issues,
  scrollEl,
  renderRow,
}: {
  issues: IssueDto[];
  scrollEl: HTMLDivElement | null;
  renderRow: (issue: IssueDto) => ReactNode;
}) {
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [margin, setMargin] = useState(0);
  const activeId = useActiveDragId();
  const activeIndex = activeId ? issues.findIndex((i) => i.id === activeId) : -1;

  // Khoảng cách từ đỉnh nội dung cuộn tới đầu danh sách (các khu phía trên đổi chiều cao thì đo lại ở lần vẽ sau).
  const measureMargin = useCallback(() => {
    if (!listEl || !scrollEl) return;
    const m = Math.round(
      listEl.getBoundingClientRect().top -
        scrollEl.getBoundingClientRect().top +
        scrollEl.scrollTop,
    );
    setMargin((prev) => (prev === m ? prev : m));
  }, [listEl, scrollEl]);
  useLayoutEffect(() => {
    measureMargin();
  });
  useLayoutEffect(() => {
    if (!scrollEl) return;
    const ro = new ResizeObserver(measureMargin);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl, measureMargin]);

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      const keep = [activeIndex];
      const focused = listEl?.contains(document.activeElement)
        ? (document.activeElement as HTMLElement).closest<HTMLElement>('[data-index]')
        : null;
      if (focused) keep.push(Number(focused.dataset.index));
      for (const k of keep) if (k >= 0 && k < range.count && !indexes.includes(k)) indexes.push(k);
      return indexes.sort((a, b) => a - b);
    },
    [activeIndex, listEl],
  );

  const virtualizer = useVirtualizer({
    count: issues.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_ESTIMATE,
    gap: ROW_GAP,
    overscan: 10,
    scrollMargin: margin,
    getItemKey: (i) => issues[i]?.id ?? i,
    rangeExtractor,
  });

  return (
    <div
      ref={setListEl}
      role="list"
      style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
    >
      {virtualizer.getVirtualItems().map((v) => {
        const issue = issues[v.index];
        if (!issue) return null;
        return (
          <div
            key={issue.id}
            role="listitem"
            aria-posinset={v.index + 1}
            aria-setsize={issues.length}
            data-index={v.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${v.start - margin}px)`,
            }}
          >
            {renderRow(issue)}
          </div>
        );
      })}
    </div>
  );
}

// eslint-disable-next-line max-lines-per-function -- thêm `meta` (L13) vượt 150 dòng 3 dòng; tách Section là việc riêng
function Section({
  id,
  title,
  badge,
  meta,
  points,
  count,
  issues,
  progressMap,
  scrollEl,
  action,
  hint,
  emptyTitle,
  emptyDescription,
  readOnly,
  canDrag,
  rowEdit,
  canEditRow,
  projectKey,
  projectId,
  canCreate,
  quickAddSprintId,
  quickAddEpicId,
  selectable,
  selected,
  onToggleSelect,
  onToggleSection,
  onOpen,
  peekedKey,
}: {
  id: string;
  title: string;
  badge: { label: string; className: string } | null;
  /** Thông tin phụ cạnh nhãn trạng thái (vd khoảng ngày + số ngày còn lại của sprint đang chạy). */
  meta?: React.ReactNode;
  points: number;
  count: number;
  issues: IssueDto[];
  progressMap: Map<string, SubtreeProgress>;
  /** Phần tử cuộn của trang — cần để ảo hoá danh sách dài. */
  scrollEl: HTMLDivElement | null;
  action?: React.ReactNode;
  hint?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Sprint đã đóng: chỉ xem, không kéo-thả. */
  readOnly?: boolean;
  /** Có được kéo dòng này không (có route kéo-thả theo quyền — `backlogDragRoute`; không có thì dòng bị vô hiệu kéo). */
  canDrag?: (issue: IssueDto) => boolean;
  /** Sửa tại chỗ điểm/ưu tiên trên dòng (không truyền cho sprint đã đóng). */
  rowEdit?: RowEdit;
  canEditRow?: (issue: IssueDto) => boolean;
  projectKey?: string;
  projectId?: string;
  canCreate?: boolean;
  /** sprintId cho quick-add (null = backlog). undefined = không hiển thị quick-add. */
  quickAddSprintId?: string | null;
  /** Đang lọc một epic → quick-add gắn luôn epic đó. */
  quickAddEpicId?: string;
  /** Bật checkbox chọn hàng loạt (không áp cho section chỉ đọc). */
  selectable?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSection?: (ids: string[], selectAll: boolean) => void;
  /** Bấm dòng/mã → mở panel xem nhanh (cả sprint đã đóng: chỉ xem vẫn mở được). */
  onOpen?: (key: string) => void;
  peekedKey?: string | null;
}) {
  const ids = useMemo(() => issues.map((i) => i.id), [issues]);
  // `container.items` để khu trống / thả vào đáy khu vẫn tính được thứ tự đích (xem `placementFromDnd`).
  const data = useMemo(() => ({ container: { items: ids } }), [ids]);
  const { setNodeRef } = useDroppable({ id, disabled: readOnly, data });
  // Viền nổi chỉ khi kéo TỪ khu khác sang (cùng khu đã có dịch chỗ live); store `dropContainer` do `onDragMove` cập nhật.
  const highlight = useIsDropContainer(id) && !readOnly;
  const showQuickAdd =
    !readOnly && canCreate && projectKey && projectId && quickAddSprintId !== undefined;
  const canSelect = !!selectable && !readOnly;
  const selectedInSection = canSelect && selected ? ids.filter((i) => selected.has(i)).length : 0;
  const allSelected = ids.length > 0 && selectedInSection === ids.length;
  const someSelected = selectedInSection > 0 && !allSelected;
  const titleTip = id === BACKLOG_ID ? BACKLOG_TIP : SPRINT_TIP;
  const renderRow = (issue: IssueDto) => (
    <IssueRow
      key={issue.id}
      issue={issue}
      progress={progressMap.get(issue.id)}
      readOnly={readOnly}
      dragDisabled={canDrag ? !canDrag(issue) : false}
      selectable={canSelect}
      checked={selected?.has(issue.id) ?? false}
      onToggleSelect={onToggleSelect}
      onOpen={onOpen}
      peeked={peekedKey === issue.key}
      edit={readOnly ? undefined : rowEdit}
      canEdit={!!canEditRow?.(issue)}
    />
  );
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'rounded-lg border border-border bg-surface transition-colors',
        highlight && 'ring-2 ring-[var(--ring)]',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {canSelect && ids.length > 0 && (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 cursor-pointer rounded border-border text-primary accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => onToggleSection?.(ids, e.target.checked)}
            aria-label={`Chọn tất cả việc trong ${title}`}
          />
        )}
        <h2 className="text-sm font-semibold text-ink-strong" title={titleTip}>
          {title}
        </h2>
        {badge && <Badge className={badge.className}>{badge.label}</Badge>}
        {meta}
        <span
          className="tabular text-xs text-muted"
          title={`${count} việc đang hiển thị · tổng ${points} điểm ước lượng (mức độ lớn của việc)`}
        >
          {count} việc · {points} điểm
        </span>
        {action && <div className="ml-auto">{action}</div>}
      </div>

      {hint && <p className="px-4 pb-2 text-xs text-muted">{hint}</p>}

      <div className="space-y-1.5 border-t border-border px-2 py-2">
        {/* items = TOÀN BỘ id của khu (kể cả dòng chưa gắn DOM do ảo hoá) để chỉ số/thứ tự dnd-kit đúng. */}
        <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
          {issues.length > VIRTUALIZE_AFTER ? (
            <VirtualRows issues={issues} scrollEl={scrollEl} renderRow={renderRow} />
          ) : (
            issues.map((issue) => renderRow(issue))
          )}
        </SortableContext>
        {issues.length === 0 &&
          (emptyTitle ? (
            <div className="p-2">
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title={emptyTitle}
                description={emptyDescription}
              />
            </div>
          ) : (
            <p className="px-2 py-5 text-center text-xs text-faint">
              {readOnly
                ? 'Sprint này không có việc nào.'
                : 'Chưa có việc nào. Kéo việc từ Việc chờ vào đây hoặc thêm mới bên dưới.'}
            </p>
          ))}
        {showQuickAdd && (
          <div data-tour={quickAddSprintId === null ? 'backlog-quickadd' : undefined}>
            <QuickAddRow
              projectKey={projectKey}
              projectId={projectId}
              extra={{
                sprintId: quickAddSprintId,
                ...(quickAddEpicId ? { epicId: quickAddEpicId } : {}),
              }}
              placeholder={
                quickAddSprintId === null
                  ? '+ Thêm việc vào Việc chờ…'
                  : '+ Thêm việc vào sprint này…'
              }
              compact
            />
          </div>
        )}
      </div>
    </section>
  );
}
