import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import type { IssueMovedPayload, IssueSetsChangedPayload } from '@tirapro/shared';
import { applyIssueSets } from '@/features/issue-meta/patchIssueSets';
import { hasPendingReactions } from '@/features/issue-edit/commentReactionSave';
import { keys } from './queryKeys';
import { queryClient } from './queryClient';
import { acquireRoom, getSocket } from './socket';

/* ------------------------------------------------------------------ */
/* Vá cache issue                                                      */
/* ------------------------------------------------------------------ */

/** Chỉ sửa cache ĐÃ có (updater trả undefined thì react-query không tạo entry mới). */
function patchList(qc: QueryClient, projectId: string, fn: (list: IssueDto[]) => IssueDto[]) {
  qc.setQueryData<IssueDto[]>(keys.issues.byProject(projectId), (old) =>
    old ? fn(old) : undefined,
  );
}

function patchDetail(qc: QueryClient, issueKey: string, fn: (old: IssueDto) => IssueDto) {
  qc.setQueryData<IssueDto>(keys.issues.byKey(issueKey), (old) => (old ? fn(old) : undefined));
}

const getList = (qc: QueryClient, projectId: string) =>
  qc.getQueryData<IssueDto[]>(keys.issues.byProject(projectId));

/** Việc chưa duyệt / tạm hoãn / đã từ chối — không thuộc Board, Việc chờ, sprint (server ẩn qua `TRIAGE_VISIBLE`). */
function isTriageHidden(issue: Pick<IssueDto, 'triageState'>): boolean {
  const st = issue.triageState;
  return st === 'PENDING' || st === 'SNOOZED' || st === 'DECLINED';
}

/** Gỡ việc khỏi cache danh sách dự án + danh sách Board có bộ lọc (không đụng cache chi tiết). */
function removeFromLists(qc: QueryClient, projectId: string, issueId: string) {
  patchList(qc, projectId, (list) =>
    list.some((i) => i.id === issueId) ? list.filter((i) => i.id !== issueId) : list,
  );
  qc.setQueriesData<IssueDto[]>({ queryKey: ['issues', 'board'] }, (old) =>
    Array.isArray(old) && old.some((i) => i.id === issueId)
      ? old.filter((i) => i.id !== issueId)
      : old,
  );
}

/** issue:created — thêm vào CUỐI danh sách nếu chưa có (event dội về sau khi mình tự tạo thì bỏ qua). Việc chưa duyệt không chèn. */
export function applyIssueCreated(qc: QueryClient, issue: IssueDto) {
  if (isTriageHidden(issue)) return;
  patchList(qc, issue.projectId, (list) =>
    list.some((i) => i.id === issue.id) ? list : [...list, issue],
  );
}

/**
 * issue:updated — payload là IssueDto đầy đủ: thay theo id CHỈ khi `version` mới hơn bản đang giữ
 * (bản bằng/cũ hơn là echo của chính mình hoặc event đến trễ → bỏ qua, không nháy/lùi dữ liệu).
 * Việc chuyển SANG trạng thái duyệt ẩn (PENDING/SNOOZED/DECLINED) → gỡ khỏi các danh sách; việc ACCEPTED mà danh sách
 * chưa có (vừa từ trạng thái ẩn ra) → nạp lại danh sách của dự án thay vì chèn.
 */
export function applyIssueUpdated(qc: QueryClient, issue: IssueDto) {
  if (isTriageHidden(issue)) {
    removeFromLists(qc, issue.projectId, issue.id);
    patchDetail(qc, issue.key, (old) => (issue.version > old.version ? { ...old, ...issue } : old));
    return;
  }
  if (
    issue.triageState === 'ACCEPTED' &&
    !getList(qc, issue.projectId)?.some((i) => i.id === issue.id)
  ) {
    void qc.invalidateQueries({ queryKey: keys.issues.byProject(issue.projectId) });
    void qc.invalidateQueries({ queryKey: ['issues', 'board'] });
    void qc.invalidateQueries({ queryKey: keys.sprints.byProject(issue.projectId) });
    patchDetail(qc, issue.key, (old) => (issue.version > old.version ? { ...old, ...issue } : old));
    return;
  }
  patchList(qc, issue.projectId, (list) => {
    const cur = list.find((i) => i.id === issue.id);
    if (!cur) return [...list, issue];
    return issue.version > cur.version
      ? list.map((i) => (i.id === issue.id ? { ...i, ...issue } : i))
      : list;
  });
  patchDetail(qc, issue.key, (old) => (issue.version > old.version ? { ...old, ...issue } : old));
}

/** issue:deleted — lọc khỏi danh sách; chi tiết đang mở sẽ tự nạp lại và báo "không tìm thấy". */
function applyIssueDeleted(qc: QueryClient, projectId: string, issueId: string) {
  const issueKey = getList(qc, projectId)?.find((i) => i.id === issueId)?.key;
  patchList(qc, projectId, (list) => list.filter((i) => i.id !== issueId));
  if (issueKey) void qc.invalidateQueries({ queryKey: keys.issues.byKey(issueKey) });
}

/**
 * issue:moved — payload không mang đủ object `status` nên chỉ vá tại chỗ khi chắc chắn đúng:
 * - `version` <= bản local: đã có (echo của optimistic) → bỏ qua.
 * - `version` === local + 1 và tìm được object status đích (từ issue khác cùng cột) cùng category:
 *   áp `{status, rank, sprintId, version}`.
 * - còn lại (bỏ lỡ event, status lạ, đổi category → resolution/resolvedAt có thể đổi): nạp lại danh sách.
 */
function applyIssueMoved(qc: QueryClient, p: IssueMovedPayload) {
  const list = getList(qc, p.projectId);
  const cur = list?.find((i) => i.id === p.issueId);
  if (!list || !cur) {
    // Không có trong danh sách (vd nằm ngoài phần đã nạp (tối đa 2000)) → chi tiết đang mở cũng có thể đã cũ.
    void qc.invalidateQueries({ queryKey: keys.issues.byProject(p.projectId) });
    // Payload chỉ có issueId (không có mã) → tìm cache chi tiết theo id của dữ liệu đang giữ.
    void qc.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === keys.issues.all[0] &&
        q.queryKey[1] === 'key' &&
        (q.state.data as IssueDto | undefined)?.id === p.issueId,
    });
    return;
  }
  if (p.version <= cur.version) return;

  const target =
    cur.status.id === p.toStatusId
      ? cur.status
      : list.find((i) => i.status.id === p.toStatusId)?.status;
  if (p.version !== cur.version + 1 || !target || target.category !== cur.status.category) {
    void qc.invalidateQueries({ queryKey: keys.issues.byProject(p.projectId) });
    void qc.invalidateQueries({ queryKey: keys.issues.byKey(cur.key) });
    return;
  }
  const patch = (i: IssueDto): IssueDto => ({
    ...i,
    status: target,
    rank: p.rank,
    sprintId: p.sprintId,
    version: p.version,
  });
  patchList(qc, p.projectId, (l) => l.map((i) => (i.id === p.issueId ? patch(i) : i)));
  patchDetail(qc, cur.key, (old) => (p.version === old.version + 1 ? patch(old) : old));
  // Chuyển cột/sprint đổi số liệu sprint (số issue, điểm).
  void qc.invalidateQueries({ queryKey: keys.sprints.byProject(p.projectId) });
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

/** Bình luận đổi (thêm/sửa/xoá) → nạp lại danh sách bình luận + hoạt động của đúng issue. */
export function applyCommentChanged(qc: QueryClient, issueId: string) {
  void qc.invalidateQueries({ queryKey: keys.issues.comments(issueId) });
  void qc.invalidateQueries({ queryKey: keys.issues.activity(issueId) });
}

/**
 * comment:reaction — ai đó thả/bỏ cảm xúc: nạp lại danh sách bình luận (chỉ đó: không sinh hoạt động). Đang có lần thả CỦA MÌNH
 * chờ ở issue này thì bỏ qua — nạp giữa chừng trả về bản chưa có lần bấm sau của mình làm chip nháy về bản cũ; `onSettled` của
 * mutation tự nạp lại khi lần cuối xong (và gồm cả thay đổi của người khác).
 */
export function applyCommentReaction(qc: QueryClient, issueId: string) {
  if (hasPendingReactions(qc, issueId)) return;
  void qc.invalidateQueries({ queryKey: keys.issues.comments(issueId) });
}

/** project:ranks_rebalanced — rank + version của cả dự án đã đổi: nạp lại danh sách và chi tiết đang giữ (tránh OCC sai). */
export function applyRanksRebalanced(qc: QueryClient, projectId: string) {
  void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
  void qc.invalidateQueries({
    predicate: (q) => {
      if (q.queryKey[0] !== keys.issues.all[0]) return false;
      // Key board chỉ chứa boardId (không có projectId) → nhận ra dự án qua dữ liệu đang giữ; board chưa nạp / rỗng
      // không có rank nào để cũ nên bỏ qua. Không đụng board của dự án khác.
      if (q.queryKey[1] === 'board')
        return (q.state.data as IssueDto[] | undefined)?.[0]?.projectId === projectId;
      if (q.queryKey[1] === 'key')
        return (q.state.data as IssueDto | undefined)?.projectId === projectId;
      return false;
    },
  });
}

/**
 * Realtime cho MỘT project — mount một lần ở `ProjectLayout` (mọi tab Board/Backlog/Gantt/Tree
 * dùng chung cache `keys.issues.byProject`) và ở trang chi tiết issue (nằm ngoài layout project).
 *
 * Không invalidate cả danh sách mỗi event: vá bằng `setQueryData` theo quy tắc version ở trên,
 * chỉ nạp lại khi không vá chắc chắn được. Payload hiện chưa mang cờ "tự echo" nên chống nháy
 * dựa vào so sánh `version`.
 */
export function useProjectRealtime(projectId: string | undefined) {
  useEffect(() => {
    if (!projectId) return;
    const qc = queryClient;
    const s = getSocket();

    // Mất kết nối rồi nối lại → có thể đã lỡ event → nạp lại những gì đang xem.
    const leave = acquireRoom({ kind: 'project', id: projectId }, () => {
      void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
      // Vai trò có thể đổi trong lúc mất kết nối (chưa có event realtime cho việc này).
      void qc.invalidateQueries({ queryKey: keys.projects.permissions(projectId) });
    });

    const onCreated = ({ issue }: { issue: IssueDto }) => {
      if (issue.projectId === projectId) applyIssueCreated(qc, issue);
    };
    const onUpdated = ({ issue }: { issue: IssueDto }) => {
      if (issue.projectId === projectId) applyIssueUpdated(qc, issue);
    };
    const onSets = (p: IssueSetsChangedPayload) => {
      if (p.projectId === projectId) applyIssueSets(qc, p);
    };
    const onMoved = (p: IssueMovedPayload) => {
      if (p.projectId === projectId) applyIssueMoved(qc, p);
    };
    const onDeleted = (p: { issueId: string; projectId: string }) => {
      if (p.projectId === projectId) applyIssueDeleted(qc, projectId, p.issueId);
    };
    const onRebalanced = (p: { projectId: string }) => {
      if (p.projectId === projectId) applyRanksRebalanced(qc, projectId);
    };
    const onComment = (p: { comment: { issueId: string } } | { issueId: string }) => {
      const issueId = 'comment' in p ? p.comment.issueId : p.issueId;
      applyCommentChanged(qc, issueId);
    };
    const onReaction = (p: { issueId: string }) => applyCommentReaction(qc, p.issueId);
    const onSprint = (p: { sprintId: string; projectId: string }) => {
      if (p.projectId !== projectId) return;
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
      // Bắt đầu/kết thúc sprint chuyển issue giữa sprint ↔ backlog.
      void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
    };

    s.on('issue:created', onCreated);
    s.on('issue:updated', onUpdated);
    s.on('issue:sets_changed', onSets);
    s.on('issue:moved', onMoved);
    s.on('issue:deleted', onDeleted);
    s.on('project:ranks_rebalanced', onRebalanced);
    s.on('comment:added', onComment);
    s.on('comment:updated', onComment);
    s.on('comment:deleted', onComment);
    s.on('comment:reaction', onReaction);
    s.on('sprint:updated', onSprint);

    return () => {
      s.off('issue:created', onCreated);
      s.off('issue:updated', onUpdated);
      s.off('issue:sets_changed', onSets);
      s.off('issue:moved', onMoved);
      s.off('issue:deleted', onDeleted);
      s.off('project:ranks_rebalanced', onRebalanced);
      s.off('comment:added', onComment);
      s.off('comment:updated', onComment);
      s.off('comment:deleted', onComment);
      s.off('comment:reaction', onReaction);
      s.off('sprint:updated', onSprint);
      leave();
    };
  }, [projectId]);
}

/**
 * Thông báo mới qua WebSocket (room `user:<id>` máy chủ tự cho vào khi kết nối) — thay cho poll 30s.
 * Mount một lần ở AppShell. Nối lại sau khi mất kết nối → nạp lại phòng khi lỡ event.
 */
export function useNotificationRealtime() {
  useEffect(() => {
    const qc = queryClient;
    const s = getSocket();
    if (!s.connected) s.connect();

    const refresh = () => {
      void qc.invalidateQueries({ queryKey: keys.notifications.popoverRoot });
      void qc.invalidateQueries({ queryKey: keys.notifications.unread });
      void qc.invalidateQueries({ queryKey: keys.notifications.pageRoot });
    };
    let seen = s.connected;
    const onConnect = () => {
      if (seen) refresh();
      seen = true;
    };
    s.on('notification:new', refresh);
    s.on('connect', onConnect);
    return () => {
      s.off('notification:new', refresh);
      s.off('connect', onConnect);
    };
  }, []);
}
