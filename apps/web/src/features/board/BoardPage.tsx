import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bug, Layers, Settings, UserRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { BoardColumnDto, BoardDto, IssueDto, SwimlaneBy } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import { buildProgressMap } from '@/lib/issueTree';
import { applyPendingOrder, sortByRank, type PendingMove } from '@/lib/rankOrder';
import type { Placement } from '@/lib/rankDrop';
import {
  isWipLimitError,
  useBoardIssues,
  useBoards,
  useTransitionIssue,
  type TransitionVars,
} from './api';
import { BoardSettingsDialog, SWIMLANE_LABEL } from './BoardSettingsDialog';
import { BoardDnd } from './BoardDnd';
import { PeekShell } from '@/features/issues/peek/PeekShell';
import { useIssuePeek } from '@/features/issues/peek/useIssuePeek';
import { Column } from './Column';
import { freshenBoardIssues } from './boardIssues';
import { noActiveSprintHint, scopeBoardIssues, swimlaneEmptyKind } from './scope';
import { NO_LANE, decideDrop, type DropContext, type DropPlan } from './dropPlan';
import { StatusPickDialog } from './StatusPickDialog';
import { useSwimlaneOverride } from './swimlane';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { useProjectSprints } from '@/features/backlog/api';
import { useProjectIssues, useUpdateIssue } from '@/features/issues/api';
import { useMoveIssue, usePendingMoves, type MoveVars } from '@/features/issues/moveIssue';
import { TruncatedBanner } from '@/features/issues/TruncatedBanner';
import type { NextStatus } from '@/features/issues/nextStatuses';
import { statusUndoAction } from '@/features/issues/statusUndo';
import { useWorkflows } from '@/features/workflow-settings/api';
import { PresenceAvatars } from '@/features/presence/PresenceAvatars';
import { Avatar, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { SprintTimeText } from '@/components/ui/SprintTimeText';
import { QueryError } from '@/components/ui/QueryError';
import { apiErrorMessage } from '@/lib/api';
import { useOpenSession } from '@/lib/useOpenSession';
import { useRetained } from '@/lib/useRetained';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { openReportIssue } from '@/stores/reportIssue';
import { useCanEditIssue, useProjectCan } from '@/features/projects/permissions';
import { QuickFilterChips } from '@/features/quick-filters/QuickFilterChips';
import { applyQuickFilters, useQuickFilters } from '@/features/quick-filters/useQuickFilters';
import { AssigneeFilter, applyAssigneeFilter } from '@/features/quick-filters/AssigneeFilter';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';

/**
 * Phân bổ 1 tập công việc vào các cột của bảng; trong cột xếp theo rank (cùng thứ tự máy chủ) rồi phủ thứ tự lạc quan
 * của các lần kéo đang chờ — thả xong thẻ nằm đúng chỗ ngay, không nhảy về chỗ cũ chờ máy chủ.
 */
function distribute(
  board: { columns: BoardColumnDto[] },
  list: IssueDto[],
  pending: readonly PendingMove[],
): Map<string, IssueDto[]> {
  const map = new Map<string, IssueDto[]>();
  for (const col of board.columns) map.set(col.id, []);
  for (const issue of list) {
    const col = board.columns.find((c) => c.statusIds.includes(issue.status.id));
    if (col) map.get(col.id)!.push(issue);
  }
  for (const [colId, l] of map) map.set(colId, applyPendingOrder(sortByRank(l), pending));
  return map;
}

interface Lane {
  key: string;
  name: string;
  avatarUrl: string | null;
  issues: IssueDto[];
  kind: SwimlaneBy;
  empty?: boolean;
}

/** Mảng rỗng dùng chung để `Column` memo không thấy prop đổi tham chiếu. */
const EMPTY: IssueDto[] = [];

/** Chia các việc thành làn (swimlane) theo cấu hình của bảng. `all` để tra tên epic/việc cha ngoài tập đang lọc. */
function buildLanes(by: SwimlaneBy, list: IssueDto[], all: IssueDto[]): Lane[] | null {
  if (by === 'none') return null;
  const byId = new Map(all.map((i) => [i.id, i]));
  const hasChildren = new Set(all.map((i) => i.parentId).filter((x): x is string => !!x));
  const groups = new Map<string, Lane & { order: number }>();
  const add = (
    key: string,
    name: string,
    avatarUrl: string | null,
    issue: IssueDto,
    order = 0,
    empty = false,
  ) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, name, avatarUrl, issues: [], kind: by, order, empty };
      groups.set(key, g);
    }
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
      if (parentId)
        add(parentId, parent ? `${parent.key} · ${parent.summary}` : 'Việc cha khác', null, i);
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
function wipCount(
  col: BoardColumnDto,
  all: IssueDto[],
  board: BoardDto,
  activeSprintId: string | null,
): number {
  if (board.type === 'SCRUM' && !activeSprintId) return 0;
  return all.filter(
    (i) =>
      col.statusIds.includes(i.status.id) &&
      (board.type !== 'SCRUM' || i.sprintId === activeSprintId),
  ).length;
}

/** Nội dung bảng công việc (cột kéo-thả). Header/nav dự án + popup tạo việc nằm ở ProjectLayout. */
export function BoardPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const {
    data: project,
    isLoading: lp,
    isError: pe,
    error: pErr,
    refetch: refetchProject,
  } = useProject(key);
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
    return freshenBoardIssues(boardIssuesQ.data ?? [], projectIssues);
  }, [hasFilter, projectIssues, boardIssuesQ.data]);
  // Bảng Scrum chỉ hiện việc của sprint ĐANG CHẠY (như WIP + máy chủ); Kanban hiện mọi việc.
  const isScrum = board?.type === 'SCRUM';
  const activeSprint = (sprintsQ.data ?? []).find((sp) => sp.state === 'ACTIVE') ?? null;
  const activeSprintId = activeSprint?.id ?? null;
  const scoped = useMemo(
    () => (board ? scopeBoardIssues(board.type, issues ?? [], activeSprintId) : (issues ?? [])),
    [board, issues, activeSprintId],
  );
  // Cache dự án đổi (chuyển cột, realtime…) thì việc khớp bộ lọc có thể đổi → nạp lại tập khớp (gộp trong 400ms).
  const projectStamp = projectIssuesQ.dataUpdatedAt;
  const refetchBoardIssues = boardIssuesQ.refetch;
  useEffect(() => {
    if (!hasFilter) return;
    const t = setTimeout(() => {
      void refetchBoardIssues();
    }, 400);
    return () => clearTimeout(t);
  }, [hasFilter, projectStamp, refetchBoardIssues]);
  const transition = useTransitionIssue(project?.id ?? '');
  const move = useMoveIssue(project?.id ?? '');
  const pending = usePendingMoves(project?.id);
  const updateIssue = useUpdateIssue(project?.id);
  const { data: workflows } = useWorkflows();
  const can = useProjectCan(project); // dự án lưu trữ: chỉ còn quyền đọc → không kéo/quick-add/cài đặt bảng
  const canEditIssue = useCanEditIssue(project?.id);
  const canTransition = can('issue:transition');
  const canAssign = can('issue:assign');
  const canCreate = can('issue:create');
  const canManageBoard = can('board:manage');
  const canManageSprint = can('sprint:manage');
  const canManageBacklog = can('backlog:manage');
  // Đổi thứ tự thẻ — đúng quyền mà API `/move` nhận cho mốc rank: `issue:edit` ĐẦY ĐỦ (không tính `:own`) HOẶC `backlog:manage`;
  // chỉ có `issue:transition` thì đổi cột được, không đổi thứ tự.
  const canEditFull = can('issue:edit');
  const canRank = useCallback(
    () => canManageBacklog || canEditFull,
    [canManageBacklog, canEditFull],
  );
  const canForceWip = can('project:admin') || can('workspace:admin');
  const currentUserId = useAuth((s) => s.user?.id);
  const { active: quickFilters, toggle: toggleQuickFilter } = useQuickFilters();
  const [assignee, setAssignee] = useState('');
  const assigneeOptions = useAssigneeOptions(project?.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Cột đầy WIP + người có quyền → hỏi "Vẫn chuyển?" (giữ nguyên biến để gửi lại kèm force).
  const [wipPrompt, setWipPrompt] = useState<{
    vars: MoveVars;
    col: BoardColumnDto;
    issueKey: string;
  } | null>(null);
  // Thả vào cột gom nhiều trạng thái mà workflow cho >1 đích → hỏi chọn (`version` chỉ có khi vừa đổi người).
  const [pick, setPick] = useState<{
    issue: IssueDto;
    col: BoardColumnDto;
    options: NextStatus[];
    /** `null` = chưa đổi người → lấy bản mới nhất của việc khi người dùng chọn (tránh 409 nếu thẻ đổi qua realtime). */
    version: number | null;
    /** Chỗ đã thả — chọn xong trạng thái thì thẻ vẫn nằm đúng chỗ đó. */
    placement: Placement;
  } | null>(null);
  // Giữ bản cuối của hai hộp hỏi để nội dung (mã việc, tên cột, danh sách đích) không trống đi giữa hiệu ứng đóng.
  const wipShown = useRetained(wipPrompt);
  const pickShown = useRetained(pick);
  const settingsKey = useOpenSession(settingsOpen);
  const {
    swimlaneBy,
    override: swimlaneOverride,
    toggleAssignee,
  } = useSwimlaneOverride(board?.id, board?.swimlaneBy ?? 'none');

  // Nhớ lọc người THEO DỰ ÁN (localStorage). Nạp khi đổi dự án.
  useEffect(() => {
    const pid = project?.id;
    if (!pid) return;
    try {
      const p = JSON.parse(localStorage.getItem(`tirapro:boardPrefs:${pid}`) || '{}') as {
        assignee?: unknown;
      };
      setAssignee(typeof p.assignee === 'string' ? p.assignee : '');
    } catch {
      setAssignee('');
    }
  }, [project?.id]);
  const changeAssignee = (v: string) => {
    setAssignee(v);
    const pid = project?.id;
    if (!pid) return;
    try {
      localStorage.setItem(`tirapro:boardPrefs:${pid}`, JSON.stringify({ assignee: v }));
    } catch {
      /* ignore */
    }
  };

  // Lọc: bộ lọc nhanh (AND) + người phụ trách. Đếm cột/làn dựa trên tập này.
  const filteredIssues = useMemo(() => {
    const base = applyQuickFilters(scoped, quickFilters, currentUserId);
    return applyAssigneeFilter(base, assignee);
  }, [scoped, quickFilters, currentUserId, assignee]);

  // Tên epic/việc cha tra trên tập ĐẦY ĐỦ của dự án (không bị thu hẹp theo sprint/bộ lọc bảng).
  const allIssues = useMemo(() => projectIssues ?? issues ?? EMPTY, [projectIssues, issues]);

  // Làn (swimlane) theo cấu hình của bảng.
  const swimlaneEmpty = swimlaneEmptyKind({
    isScrum,
    scopedCount: scoped.length,
    filtered: hasFilter || assignee !== '' || quickFilters.size > 0,
  });
  const lanes = useMemo(
    () => buildLanes(swimlaneBy, filteredIssues, allIssues),
    [swimlaneBy, filteredIssues, allIssues],
  );

  // Phân bổ việc vào cột MỘT lần cho cả bảng phẳng lẫn mọi làn; mảng của cột không đổi nội dung thì giữ nguyên
  // tham chiếu để `Column` (memo) khỏi vẽ lại khi chỉ có cột khác thay đổi.
  const prevLists = useRef(new Map<string, IssueDto[]>());
  const { byColumn, laneCols } = useMemo(() => {
    const prev = prevLists.current;
    const next = new Map<string, IssueDto[]>();
    const stable = (k: string, arr: IssueDto[]) => {
      const p = prev.get(k);
      const v = p && p.length === arr.length && p.every((x, i) => x === arr[i]) ? p : arr;
      next.set(k, v);
      return v;
    };
    const run = (prefix: string, list: IssueDto[]) => {
      const out = new Map<string, IssueDto[]>();
      if (!board) return out;
      for (const [colId, arr] of distribute(board, list, pending))
        out.set(colId, stable(`${prefix}::${colId}`, arr));
      return out;
    };
    const byCol = lanes ? new Map<string, IssueDto[]>() : run('', filteredIssues);
    const byLane = new Map<string, Map<string, IssueDto[]>>();
    for (const lane of lanes ?? []) byLane.set(lane.key, run(lane.key, lane.issues));
    prevLists.current = next;
    return { byColumn: byCol, laneCols: byLane };
  }, [board, filteredIssues, lanes, pending]);

  // Số việc tính vào WIP của từng cột — tính một lần thay vì mỗi cột × mỗi làn × mỗi lần vẽ.
  const wipByCol = useMemo(() => {
    const m = new Map<string, number>();
    if (!board) return m;
    for (const col of board.columns)
      if (col.wipLimit != null)
        m.set(col.id, wipCount(col, projectIssues ?? [], board, activeSprintId));
    return m;
  }, [board, projectIssues, activeSprintId]);

  // Tiến độ epic/việc cha tính trên tập đầy đủ: con nằm ở sprint khác vẫn được tính.
  const progressMap = useMemo(() => buildProgressMap(allIssues), [allIssues]);

  // Thêm nhanh ở bảng Scrum: việc mới vào luôn sprint đang chạy (nếu không, nó biến mất khỏi bảng).
  const quickAddExtra = useMemo(
    () => (isScrum && activeSprintId ? { sprintId: activeSprintId } : undefined),
    [isScrum, activeSprintId],
  );

  const peek = useIssuePeek();
  const openIssue = peek.open; // bấm thẻ → xem nhanh ở cột phải (?peek=KEY); `open` ổn định nên Card memo không vẽ lại

  /** Cột đầy WIP: người có quyền được hỏi "Vẫn chuyển?", người khác nhận lời nhắc rõ việc cần làm. */
  function onWipBlocked(err: unknown, vars: MoveVars, col: BoardColumnDto, issueKey: string) {
    void apiErrorMessage(err); // đánh dấu đã xử lý → MutationCache không toast thêm lần hai
    if (canForceWip) setWipPrompt({ vars, col, issueKey });
    else
      toast.error(
        `Cột “${col.name}” đã đạt giới hạn ${col.wipLimit ?? ''} việc đang làm — hãy hoàn thành bớt việc trong cột này trước, hoặc nhờ quản trị dự án cho phép vượt giới hạn.`,
      );
  }

  /** Kéo sang cột khác: MỘT `move` mang trạng thái + hai mốc (thẻ nằm đúng chỗ đã thả). `force` chỉ khi đã xác nhận "Vẫn chuyển". */
  async function runMove(
    issue: IssueDto,
    col: BoardColumnDto,
    toStatusId: string,
    p: Placement,
    o: { force?: boolean; statusName?: string; version?: number } = {},
  ) {
    if (!board) return;
    const statusName = o.statusName ?? col.name;
    // Không có quyền xếp thứ tự → không gửi mốc (máy chủ giữ rank), kể cả khi Hoàn tác.
    const ranked = canRank();
    const vars: MoveVars = {
      route: 'move',
      id: issue.id,
      key: issue.key,
      version: o.version ?? issue.version,
      afterId: ranked ? p.afterId : null,
      beforeId: ranked ? p.beforeId : null,
      statusId: toStatusId,
      statusName,
      boardId: board.id,
      ...(o.force ? { force: true } : {}),
    };
    const from = { statusId: issue.status.id, statusName: issue.status.name };
    try {
      const updated = await move.mutateAsync(vars);
      toast.success(`Đã chuyển ${issue.key} sang “${statusName}”`, {
        duration: 4000,
        // Chỉ hứa "Hoàn tác" khi workflow cho phép bước ngược (vd Done chỉ về To Do thì bấm sẽ bị 409).
        action: statusUndoAction(workflows, from.statusId, toStatusId, () =>
          // Quay về cột cũ + chỗ cũ; không gửi boardId (không làm cột đích đầy thêm, không cần kiểm WIP).
          move.mutateAsync({
            route: 'move',
            id: issue.id,
            key: issue.key,
            version: updated.version,
            afterId: ranked ? p.origin.afterId : null,
            beforeId: ranked ? p.origin.beforeId : null,
            ...from,
          }),
        ),
      });
    } catch (err) {
      if (isWipLimitError(err)) onWipBlocked(err, vars, col, issue.key); // lỗi khác: hook + MutationCache đã báo
    }
  }

  /** Đổi chỗ trong cùng cột: một `move` chỉ có hai mốc. */
  async function runReorder(issue: IssueDto, p: Placement) {
    try {
      const updated = await move.mutateAsync({
        route: 'move',
        id: issue.id,
        key: issue.key,
        version: issue.version,
        afterId: p.afterId,
        beforeId: p.beforeId,
      });
      toast.success(`Đã đổi thứ tự ${issue.key}`, {
        duration: 3000,
        action: {
          label: 'Hoàn tác',
          onClick: () =>
            void move
              .mutateAsync({
                route: 'move',
                id: issue.id,
                key: issue.key,
                version: updated.version,
                afterId: p.origin.afterId,
                beforeId: p.origin.beforeId,
              })
              .catch(() => undefined),
        },
      });
    } catch {
      /* hook + MutationCache đã báo */
    }
  }

  async function confirmForce() {
    if (!wipPrompt) return;
    const { vars, col, issueKey } = wipPrompt;
    setWipPrompt(null);
    try {
      await move.mutateAsync({ ...vars, force: true });
      toast.success(`Đã chuyển ${issueKey} sang “${col.name}” (vượt giới hạn WIP)`, {
        duration: 4000,
      });
    } catch {
      /* hook + MutationCache đã báo */
    }
  }

  // Một nguồn quyết định "thả thì làm gì" cho cả `onMove` lẫn phản hồi lúc kéo (vạch chèn/viền/thông báo).
  const dropCtx: DropContext = {
    columns: board?.columns ?? [],
    workflows,
    swimlaneBy,
    canAssign,
    canEditIssue,
    canRank,
  };
  const planOfRef = useRef<(issue: IssueDto, p: Placement) => DropPlan | null>(() => null);
  planOfRef.current = (issue, p) =>
    canTransition ? (decideDrop(issue, p, dropCtx)?.plan ?? null) : null;
  const planOf = useCallback((issue: IssueDto, p: Placement) => planOfRef.current(issue, p), []);

  async function onMove(issueId: string, p: Placement | null) {
    const issue = (issues ?? []).find((i) => i.id === issueId);
    // Không có quyền chuyển cột thì thẻ không kéo được; chốt chặn thêm cho trường hợp quyền đổi giữa lúc kéo.
    if (!issue || !p || !canTransition) return;
    const d = decideDrop(issue, p, dropCtx);
    // Cột chưa gắn trạng thái nào thì không có đích để chuyển tới.
    if (!d) return;
    const { col, res, plan, wantsReassign, assigneeChanged, targetAssignee, rankDenied } = d;
    const only = res.kind === 'move' && res.options.length === 1 ? res.options[0]! : null;
    const labelFor = (o: NextStatus) => (col.statusIds.length > 1 ? o.name : col.name);
    const blockedMsg = `Quy trình không cho chuyển “${issue.status.name}” sang cột “${col.name}”. Hãy chọn một trạng thái trong danh sách gợi ý.`;

    if (plan === 'ignore') {
      // Thả sang hàng người khác nhưng không được đổi người phụ trách việc này → nói rõ thay vì lặng lẽ không làm gì.
      if (wantsReassign && !assigneeChanged)
        toast.info('Bạn không có quyền đổi người phụ trách việc này.');
      else if (rankDenied)
        toast.info(
          'Bạn không có quyền đổi thứ tự thẻ trong cột — hãy kéo sang cột khác để đổi trạng thái.',
        );
      return;
    }
    if (plan === 'reorder') {
      void runReorder(issue, p);
      return;
    }
    if (plan === 'blocked') {
      if (wantsReassign) toast.info('Bạn không có quyền đổi người phụ trách việc này.');
      toast.error(blockedMsg);
      return;
    }
    if (plan === 'status' || plan === 'status-only') {
      if (wantsReassign) toast.info('Bạn không có quyền đổi người phụ trách việc này.');
      if (only) void runMove(issue, col, only.id, p, { statusName: labelFor(only) });
      else if (res.kind === 'move')
        setPick({ issue, col, options: res.options, version: null, placement: p });
      return;
    }

    // Hàng theo người: thả sang hàng khác → đổi người phụ trách (hàng "Chưa có người phụ trách" = bỏ gán);
    // có thể kèm đổi trạng thái nếu thả sang cột khác.
    let version = issue.version;
    try {
      const updated = await updateIssue.mutateAsync({
        id: issue.id,
        key: issue.key,
        patch: { assigneeId: targetAssignee },
        version,
      });
      version = updated.data.version;
    } catch (err) {
      toast.error(apiErrorMessage(err));
      return;
    }
    const who =
      targetAssignee == null
        ? 'bỏ người phụ trách'
        : `giao cho ${assigneeOptions.find((o) => o.id === targetAssignee)?.name ?? 'người khác'}`;
    if (res.kind === 'blocked') {
      toast.success(`Đã cập nhật ${issue.key} · ${who}`, { duration: 3000 });
      toast.error(blockedMsg);
      return;
    }
    if (res.kind === 'move' && !only) {
      // Đã đổi người; còn phải chọn trạng thái đích.
      toast.success(`Đã cập nhật ${issue.key} · ${who}`, { duration: 3000 });
      setPick({ issue, col, options: res.options, version, placement: p });
      return;
    }
    if (only && board) {
      const vars: TransitionVars = {
        id: issue.id,
        toStatusId: only.id,
        version,
        statusName: labelFor(only),
        boardId: board.id,
      };
      try {
        await transition.mutateAsync(vars);
      } catch (err) {
        if (isWipLimitError(err)) {
          toast.success(
            `Đã giao ${issue.key} cho ${assigneeOptions.find((o) => o.id === targetAssignee)?.name ?? 'người khác'}`,
            { duration: 3000 },
          );
          // "Vẫn chuyển" gửi lại bằng `move` (không mốc ⇒ giữ rank) — tương đương transition.
          onWipBlocked(
            err,
            {
              route: 'move',
              id: issue.id,
              key: issue.key,
              version,
              afterId: null,
              beforeId: null,
              statusId: only.id,
              statusName: labelFor(only),
              boardId: board.id,
            },
            col,
            issue.key,
          );
        } else {
          toast.error(apiErrorMessage(err));
        }
        return;
      }
    }
    const parts = [only ? `sang “${labelFor(only)}”` : '', `· ${who}`].filter(Boolean).join(' ');
    toast.success(`Đã cập nhật ${issue.key} ${parts}`.trim(), { duration: 3000 });
  }

  if (pe) {
    return (
      <div className="p-6">
        <QueryError error={pErr} onRetry={() => refetchProject()} />
      </div>
    );
  }

  const sprintsFailed = isScrum && sprintsQ.isError;
  if (
    boardsQ.isError ||
    projectIssuesQ.isError ||
    (hasFilter && boardIssuesQ.isError) ||
    sprintsFailed
  ) {
    return (
      <div className="p-6">
        <QueryError
          error={
            boardsQ.error ??
            projectIssuesQ.error ??
            boardIssuesQ.error ??
            (sprintsFailed ? sprintsQ.error : null)
          }
          onRetry={() => {
            void boardsQ.refetch();
            void projectIssuesQ.refetch();
            if (hasFilter) void boardIssuesQ.refetch();
            if (isScrum) void sprintsQ.refetch();
          }}
        />
      </div>
    );
  }

  // Chờ cả danh sách sprint (bảng Scrum) rồi mới quyết định hiện việc/trạng thái trống — không nháy.
  if (lp || lb || li || (isScrum && sprintsQ.isLoading)) {
    return (
      <div className="p-6">
        <div className="flex gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72 w-[21.6rem] shrink-0" />
          ))}
        </div>
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

  return (
    <BoardDnd issues={scoped} columns={board.columns} onMove={onMove} planOf={planOf}>
      {/* PeekShell BÊN TRONG BoardDnd: DragOverlay vẫn phủ toàn khung, panel không là droppable. */}
      <PeekShell>
        <div className="flex min-h-0 flex-1 flex-col">
          <TruncatedBanner projectId={project?.id} />
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3">
            <QuickFilterChips active={quickFilters} onToggle={toggleQuickFilter} />
            <AssigneeFilter options={assigneeOptions} value={assignee} onChange={changeAssignee} />
            <button
              type="button"
              onClick={toggleAssignee}
              aria-pressed={swimlaneBy === 'assignee'}
              title={`Chia bảng thành hàng theo người phụ trách — chỉ áp cho bạn${swimlaneOverride === null ? '' : ' (đang khác cấu hình bảng)'}. Kéo việc sang hàng khác để giao cho người đó.`}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                swimlaneBy === 'assignee'
                  ? 'border-transparent bg-primary-subtle text-primary'
                  : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              <Users className="h-3.5 w-3.5" aria-hidden /> Nhóm theo người
            </button>
            {canCreate && !project?.archivedAt && (
              <button
                type="button"
                onClick={() => openReportIssue({ projectKey: key, kind: 'BUG' })}
                title="Báo lỗi hoặc gửi yêu cầu cho dự án này"
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <Bug className="h-3.5 w-3.5" aria-hidden /> Báo lỗi
              </button>
            )}
            {swimlaneBy !== 'none' && swimlaneBy !== 'assignee' && (
              <span
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-transparent bg-primary-subtle px-2.5 text-xs font-medium text-primary"
                title={`Bảng đang chia hàng: ${SWIMLANE_LABEL[swimlaneBy].toLowerCase()}.`}
              >
                <Layers className="h-3.5 w-3.5" /> {SWIMLANE_LABEL[swimlaneBy]}
              </span>
            )}
            {isScrum && activeSprint && (
              <span
                className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-full border border-border px-2.5 text-xs text-muted"
                title={`Bảng Scrum chỉ hiện việc của sprint đang chạy${activeSprint.goal ? ` · Mục tiêu: ${activeSprint.goal}` : ''}`}
              >
                <span className="truncate">Sprint: {activeSprint.name}</span>
                <SprintTimeText sprint={activeSprint} />
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  title="Cột, giới hạn WIP, bộ lọc và cách chia hàng của bảng"
                >
                  <Settings className="h-4 w-4" /> Cài đặt bảng
                </Button>
              )}
            </div>
          </div>

          {isScrum && !activeSprintId ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <EmptyState
                title="Chưa có sprint nào đang chạy"
                description={noActiveSprintHint({
                  canManageSprint,
                  archived: !!project?.archivedAt,
                })}
                action={<Button onClick={() => navigate(`/p/${key}/backlog`)}>Mở Backlog</Button>}
              />
            </div>
          ) : lanes ? (
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4">
              {lanes.length === 0 ? (
                swimlaneEmpty === 'filtered' ? (
                  <p className="py-10 text-center text-sm text-faint">
                    Không có việc nào khớp bộ lọc. Tắt bớt bộ lọc phía trên để xem thêm.
                  </p>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <p className="text-sm text-faint">
                      {swimlaneEmpty === 'sprint'
                        ? 'Sprint này chưa có việc nào. Thêm việc từ Backlog.'
                        : 'Bảng chưa có việc nào. Thêm việc từ Backlog.'}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/p/${key}/backlog`)}
                    >
                      Mở Backlog
                    </Button>
                  </div>
                )
              ) : (
                lanes.map((lane, laneIdx) => {
                  const cols = laneCols.get(lane.key);
                  return (
                    <section key={lane.key}>
                      <div className="mb-2 flex items-center gap-2">
                        {lane.kind === 'assignee' ? (
                          lane.empty ? (
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-faint">
                              <UserRound className="h-3.5 w-3.5" />
                            </span>
                          ) : (
                            <Avatar name={lane.name} src={lane.avatarUrl} size={24} />
                          )
                        ) : (
                          <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-2 text-faint">
                            <Layers className="h-3.5 w-3.5" />
                          </span>
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
                            issues={cols?.get(col.id) ?? EMPTY}
                            progressMap={progressMap}
                            onOpen={openIssue}
                            projectKey={key}
                            projectId={project?.id ?? ''}
                            canCreate={false}
                            canDrag={canTransition}
                            droppableId={`${lane.key}::${col.id}`}
                            laneIdx={laneIdx}
                            colIdx={colIdx}
                            wipUsed={wipByCol.get(col.id) ?? 0}
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
                  quickAddExtra={quickAddExtra}
                  canDrag={canTransition}
                  laneIdx={0}
                  colIdx={colIdx}
                  wipUsed={wipByCol.get(col.id) ?? 0}
                />
              ))}
            </div>
          )}
        </div>
      </PeekShell>

      {/* Luôn mount sau lần mở đầu (để có hiệu ứng đóng); key theo lần mở → bản nháp cột khởi tạo lại. */}
      {settingsKey > 0 && project?.id && (
        <BoardSettingsDialog
          key={settingsKey}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          projectId={project.id}
          board={board}
        />
      )}
      <ConfirmDialog
        open={!!wipPrompt}
        danger={false}
        title={`Cột “${wipShown?.col.name ?? ''}” đã đạt giới hạn WIP`}
        description={`Cột chỉ nên có tối đa ${wipShown?.col.wipLimit ?? ''} việc đang làm cùng lúc. Chuyển ${wipShown?.issueKey ?? 'việc này'} vào sẽ vượt giới hạn đó. Bạn vẫn muốn chuyển?`}
        confirmLabel="Vẫn chuyển"
        cancelLabel="Giữ nguyên"
        onConfirm={() => void confirmForce()}
        onCancel={() => setWipPrompt(null)}
      />
      {pickShown && (
        <StatusPickDialog
          open={!!pick}
          issueKey={pickShown.issue.key}
          colName={pickShown.col.name}
          options={pickShown.options}
          onPick={(id, name) => {
            const p = pickShown;
            setPick(null);
            const latest = (issues ?? []).find((i) => i.id === p.issue.id) ?? p.issue;
            void runMove(latest, p.col, id, p.placement, {
              statusName: name,
              version: p.version ?? latest.version,
            });
          }}
          onCancel={() => setPick(null)}
        />
      )}
    </BoardDnd>
  );
}
