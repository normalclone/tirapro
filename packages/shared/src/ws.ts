/** Hợp đồng socket.io typed dùng chung gateway (BE) và client (FE). */
import type { CommentDto, ID, IssueDto, NotificationDto } from '@tirapro/types';

export type RoomTarget =
  | { kind: 'project'; id: string }
  | { kind: 'board'; id: string }
  | { kind: 'backlog'; id: string }
  | { kind: 'issue'; id: string }
  | { kind: 'sprint'; id: string };

export interface IssueMovedPayload {
  issueId: ID;
  projectId: ID;
  fromStatusId: ID | null;
  toStatusId: ID;
  rank: string;
  sprintId: ID | null;
  version: number;
  actorId: ID;
}

export interface PresenceUser {
  userId: ID;
  displayName: string;
  avatarUrl: string | null;
  viewing?: string | null; // room hiện đang xem (vd issue:<id>)
}

export interface TypingPayload {
  room: string;
  userId: ID;
  displayName: string;
}

export interface AiStreamChunk {
  jobId: string;
  delta?: string;
  done?: boolean;
  error?: string;
}

/** Sự kiện server -> client. */
export interface ServerToClientEvents {
  'issue:created': (p: { issue: IssueDto }) => void;
  'issue:updated': (p: { issue: IssueDto }) => void;
  'issue:moved': (p: IssueMovedPayload) => void;
  'issue:deleted': (p: { issueId: ID; projectId: ID }) => void;
  'comment:added': (p: { comment: CommentDto }) => void;
  'comment:updated': (p: { comment: CommentDto }) => void;
  'comment:deleted': (p: { commentId: ID; issueId: ID }) => void;
  'sprint:updated': (p: { sprintId: ID; projectId: ID }) => void;
  'notification:new': (p: { notification: NotificationDto }) => void;
  'presence:state': (p: { room: string; users: PresenceUser[] }) => void;
  'presence:join': (p: { room: string; user: PresenceUser }) => void;
  'presence:leave': (p: { room: string; userId: ID }) => void;
  typing: (p: TypingPayload & { typing: boolean }) => void;
  'ai:stream': (p: AiStreamChunk) => void;
}

/** Sự kiện client -> server. */
export interface ClientToServerEvents {
  subscribe: (target: RoomTarget, ack?: (ok: boolean) => void) => void;
  unsubscribe: (target: RoomTarget) => void;
  'presence:view': (p: { room: string | null }) => void;
  'typing:start': (p: { room: string }) => void;
  'typing:stop': (p: { room: string }) => void;
}
