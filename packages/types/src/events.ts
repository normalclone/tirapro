/**
 * Tên sự kiện dùng chung.
 * - DOMAIN_EVENTS: nội bộ backend (EventEmitter2), format "domain.action".
 * - WS_EVENTS: socket.io giữa BE<->FE, format "domain:action".
 * - rooms(): helper sinh tên room nhất quán giữa gateway và client.
 */

export const DOMAIN_EVENTS = {
  ISSUE_CREATED: 'issue.created',
  ISSUE_UPDATED: 'issue.updated',
  ISSUE_MOVED: 'issue.moved',
  PROJECT_RANKS_REBALANCED: 'project.ranks_rebalanced', // payload { projectId } — rank cả project vừa được đánh số lại
  ISSUE_DELETED: 'issue.deleted',
  ISSUE_TRANSITIONED: 'issue.transitioned',
  ISSUE_CHANGED: 'issue.changed', // tổng quát -> IssueHistory ingest
  COMMENT_ADDED: 'comment.added',
  COMMENT_UPDATED: 'comment.updated',
  COMMENT_DELETED: 'comment.deleted',
  SPRINT_STARTED: 'sprint.started',
  SPRINT_COMPLETED: 'sprint.completed',
  SPRINT_UPDATED: 'sprint.updated',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  MEMBER_REMOVED: 'member.removed', // payload { workspaceId, userId } — gateway ngắt socket của user khỏi workspace
  // payload { userId } — phiên của user bị thu hồi (khoá / đặt lại mật khẩu / đăng xuất mọi thiết bị): gateway ngắt mọi socket của user
  ACCOUNT_SESSIONS_REVOKED: 'account.sessions_revoked',
  NOTIFICATION_CREATED: 'notification.created',
  MENTION_CREATED: 'mention.created',
  WORKLOG_CREATED: 'worklog.created',
  WORKLOG_UPDATED: 'worklog.updated',
  WORKLOG_DELETED: 'worklog.deleted',
} as const;
/**
 * Metadata chống vòng lặp của automation, nằm ở `payload.meta` của sự kiện issue/comment.
 * - `automationDepth`: số tầng automation đã nối nhau (sự kiện do người dùng thật gây ra → không có/0).
 * - `automationChain`: id các quy tắc đã chạy trong chuỗi này — một quy tắc không chạy lại trong chính chuỗi của nó.
 */
export interface AutomationEventMeta {
  automationDepth?: number;
  automationChain?: string[];
}

export type DomainEvent = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

export const WS_EVENTS = {
  // server -> client
  ISSUE_CREATED: 'issue:created',
  ISSUE_UPDATED: 'issue:updated',
  ISSUE_MOVED: 'issue:moved',
  ISSUE_DELETED: 'issue:deleted',
  PROJECT_RANKS_REBALANCED: 'project:ranks_rebalanced',
  COMMENT_ADDED: 'comment:added',
  COMMENT_UPDATED: 'comment:updated',
  COMMENT_DELETED: 'comment:deleted',
  SPRINT_UPDATED: 'sprint:updated',
  NOTIFICATION_NEW: 'notification:new',
  PRESENCE_STATE: 'presence:state',
  PRESENCE_JOIN: 'presence:join',
  PRESENCE_LEAVE: 'presence:leave',
  TYPING: 'typing',
  AI_STREAM: 'ai:stream',
  // client -> server
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PRESENCE_VIEW: 'presence:view',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
} as const;
export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export const rooms = {
  workspace: (id: string) => `ws:${id}`,
  user: (id: string) => `user:${id}`,
  project: (id: string) => `project:${id}`,
  board: (id: string) => `board:${id}`,
  backlog: (projectId: string) => `backlog:${projectId}`,
  issue: (id: string) => `issue:${id}`,
  sprint: (id: string) => `sprint:${id}`,
} as const;

export type RoomKind = keyof typeof rooms;
