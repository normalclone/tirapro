import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { DOMAIN_EVENTS, WS_EVENTS, rooms } from '@tirapro/types';

interface RoomTarget {
  kind: 'project' | 'board' | 'backlog' | 'issue' | 'sprint';
  id: string;
}

/**
 * Socket.io gateway: xác thực JWT ở handshake, quản lý room, và RealtimeBridge
 * (@OnEvent domain events → broadcast). Single-node in-memory; scale-out dùng Redis adapter (P2).
 */
@WebSocketGateway({ path: '/realtime', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(client: Socket): void {
    try {
      const raw =
        (client.handshake.auth?.token as string) ||
        String(client.handshake.headers.authorization ?? '').replace('Bearer ', '');
      const payload = this.jwt.verify<{ sub: string; workspaceId: string | null }>(raw, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      client.data.userId = payload.sub;
      client.data.workspaceId = payload.workspaceId;
      void client.join(rooms.user(payload.sub));
      if (payload.workspaceId) void client.join(rooms.workspace(payload.workspaceId));
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage(WS_EVENTS.SUBSCRIBE)
  onSubscribe(@MessageBody() target: RoomTarget, @ConnectedSocket() client: Socket): { ok: true } {
    if (target?.kind && target?.id) void client.join(`${target.kind}:${target.id}`);
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.UNSUBSCRIBE)
  onUnsubscribe(@MessageBody() target: RoomTarget, @ConnectedSocket() client: Socket): void {
    if (target?.kind && target?.id) void client.leave(`${target.kind}:${target.id}`);
  }

  // ---------- RealtimeBridge: domain event -> broadcast ----------
  private toProject(projectId: string | undefined, event: string, payload: unknown) {
    if (!projectId || !this.server) return;
    this.server.to(rooms.project(projectId)).emit(event, payload);
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_CREATED)
  onIssueCreated(p: { issue: { projectId: string } }) {
    this.toProject(p.issue?.projectId, WS_EVENTS.ISSUE_CREATED, { issue: p.issue });
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_UPDATED)
  onIssueUpdated(p: { issue: { projectId: string } }) {
    this.toProject(p.issue?.projectId, WS_EVENTS.ISSUE_UPDATED, { issue: p.issue });
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_TRANSITIONED)
  onIssueTransitioned(p: { issue: { projectId: string } }) {
    this.toProject(p.issue?.projectId, WS_EVENTS.ISSUE_UPDATED, { issue: p.issue });
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_MOVED)
  onIssueMoved(p: { projectId: string }) {
    this.toProject(p.projectId, WS_EVENTS.ISSUE_MOVED, p);
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_DELETED)
  onIssueDeleted(p: { issueId: string; projectId?: string }) {
    this.toProject(p.projectId, WS_EVENTS.ISSUE_DELETED, p);
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_ADDED)
  onCommentAdded(p: { comment: unknown; projectId?: string; issueId: string }) {
    this.toProject(p.projectId, WS_EVENTS.COMMENT_ADDED, { comment: p.comment });
  }
}
