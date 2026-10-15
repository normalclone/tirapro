import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import type { IssueMovedPayload } from '@tirapro/shared';
import { keys } from './queryKeys';
import { queryClient } from './queryClient';
import { acquireRoom, getSocket } from './socket';

/* ------------------------------------------------------------------ */
/* Vá cache issue                                                      */
/* ------------------------------------------------------------------ */

/** Chỉ sửa cache ĐÃ có (updater trả undefined thì react-query không tạo entry mới). */
function patchList(qc: QueryClient, projectId: string, fn: (list: IssueDto[]) => IssueDto[]) {
  qc.setQueryData<IssueDto[]>(keys.issues.byProject(projectId), (old) => (old ? fn(old) : undefined));
}

function patchDetail(qc: QueryClient, issueKey: string, fn: (old: IssueDto) => IssueDto) {
  qc.setQueryData<IssueDto>(keys.issues.byKey(issueKey), (old) => (old ? fn(old) : undefined));
}

const getList = (qc: QueryClient, projectId: string) =>
  qc.getQueryData<IssueDto[]>(keys.issues.byProject(projectId));

/** issue:created — thêm vào CUỐI danh sách nếu chưa có (event dội về sau khi mình tự tạo thì bỏ qua). */
export function applyIssueCreated(qc: QueryClient, issue: IssueDto) {
  patchList(qc, issue.projectId, (list) => (list.some((i) => i.id === issue.id) ? list : [...list, issue]));
}

/**
 * issue:updated — payload là IssueDto đầy đủ: thay theo id CHỈ khi `version` mới hơn bản đang giữ
 * (bản bằng/cũ hơn là echo của chính mình hoặc event đến trễ → bỏ qua, không nháy/lùi dữ liệu).
 */
export function applyIssueUpdated(qc: QueryClient, issue: IssueDto) {
  patchList(qc, issue.projectId, (list) => {
    const cur = list.find((i) => i.id === issue.id);
    if (!cur) return [...list, issue];
    return issue.version > cur.version ? list.map((i) => (i.id === issue.id ? { ...i, ...issue } : i)) : list;
  });
  patchDetail(qc, issue.key, (old) => (issue.version > old.version ? { ...old, ...issue } : old));
}

/** issue:deleted — lọc khỏi danh sách; chi tiết đang mở sẽ tự nạp lại và báo "không tìm thấy". */
export function applyIssueDeleted(qc: QueryClient, projectId: string, issueId: string) {
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
export function applyIssueMoved(qc: QueryClient, p: IssueMovedPayload) {
  const list = getList(qc, p.projectId);
  const cur = list?.find((i) => i.id === p.issueId);
  if (!list || !cur) {
    // Không có trong danh sách (vd nằm ngoài 200 issue đầu) → chi tiết đang mở cũng có thể đã cũ.
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
    });

    const onCreated = ({ issue }: { issue: IssueDto }) => {
      if (issue.projectId === projectId) applyIssueCreated(qc, issue);
    };
    const onUpdated = ({ issue }: { issue: IssueDto }) => {
      if (issue.projectId === projectId) applyIssueUpdated(qc, issue);
    };
    const onMoved = (p: IssueMovedPayload) => {
      if (p.projectId === projectId) applyIssueMoved(qc, p);
    };
    const onDeleted = (p: { issueId: string; projectId: string }) => {
      if (p.projectId === projectId) applyIssueDeleted(qc, projectId, p.issueId);
    };
    const onComment = (p: { comment: { issueId: string } } | { issueId: string }) => {
      const issueId = 'comment' in p ? p.comment.issueId : p.issueId;
      void qc.invalidateQueries({ queryKey: keys.issues.comments(issueId) });
      void qc.invalidateQueries({ queryKey: keys.issues.activity(issueId) });
    };
    const onSprint = (p: { sprintId: string; projectId: string }) => {
      if (p.projectId !== projectId) return;
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
      // Bắt đầu/kết thúc sprint chuyển issue giữa sprint ↔ backlog.
      void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
    };

    s.on('issue:created', onCreated);
    s.on('issue:updated', onUpdated);
    s.on('issue:moved', onMoved);
    s.on('issue:deleted', onDeleted);
    s.on('comment:added', onComment);
    s.on('comment:updated', onComment);
    s.on('comment:deleted', onComment);
    s.on('sprint:updated', onSprint);

    return () => {
      s.off('issue:created', onCreated);
      s.off('issue:updated', onUpdated);
      s.off('issue:moved', onMoved);
      s.off('issue:deleted', onDeleted);
      s.off('comment:added', onComment);
      s.off('comment:updated', onComment);
      s.off('comment:deleted', onComment);
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
      void qc.invalidateQueries({ queryKey: keys.notifications.list });
      void qc.invalidateQueries({ queryKey: keys.notifications.unread });
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
