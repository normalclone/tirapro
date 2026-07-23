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
  NOTIFICATION_CREATED: 'notification.created',
  MENTION_CREATED: 'mention.created',
} as const;
export type DomainEvent = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

export const WS_EVENTS = {
  // server -> client
  ISSUE_CREATED: 'issue:created',
  ISSUE_UPDATED: 'issue:updated',
  ISSUE_MOVED: 'issue:moved',
  ISSUE_DELETED: 'issue:deleted',
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
