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
import type { RoomTarget, SubscribeAck } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Socket.io gateway: xác thực JWT ở handshake, kiểm quyền khi subscribe room, và RealtimeBridge
 * (@OnEvent domain events → broadcast). CORS và Redis adapter (scale-out nhiều node) được cấu hình
 * ở RedisIoAdapter (main.ts) vì decorator này không đọc được config lúc chạy.
 */
@WebSocketGateway({ path: '/realtime' })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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

  /**
   * Chỉ cho vào room của chính mình: user = chính user, workspace = workspace của token,
   * project = project còn sống thuộc workspace của token. Mọi trường hợp khác trả FORBIDDEN.
   */
  @SubscribeMessage(WS_EVENTS.SUBSCRIBE)
  async onSubscribe(
    @MessageBody() target: RoomTarget,
    @ConnectedSocket() client: Socket,
  ): Promise<SubscribeAck> {
    const room = await this.authorizeRoom(target, client);
    if (!room) return { ok: false, error: 'FORBIDDEN' };
    await client.join(room);
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.UNSUBSCRIBE)
  async onUnsubscribe(@MessageBody() target: RoomTarget, @ConnectedSocket() client: Socket): Promise<void> {
    const room = this.roomName(target);
    if (room) await client.leave(room);
  }

  /** Tên room theo loại; null nếu loại không được hỗ trợ. */
  private roomName(target: RoomTarget | undefined): string | null {
    if (!target?.kind || !target?.id || typeof target.id !== 'string') return null;
    switch (target.kind) {
      case 'user':
        return rooms.user(target.id);
      case 'workspace':
        return rooms.workspace(target.id);
      case 'project':
        return rooms.project(target.id);
      default:
        return null;
    }
  }

  /** Trả tên room nếu client được phép vào, ngược lại null. */
  private async authorizeRoom(target: RoomTarget | undefined, client: Socket): Promise<string | null> {
    const room = this.roomName(target);
    if (!room || !target) return null;
    const { userId, workspaceId } = client.data as { userId?: string; workspaceId?: string | null };
    switch (target.kind) {
      case 'user':
        return userId && target.id === userId ? room : null;
      case 'workspace':
        return workspaceId && target.id === workspaceId ? room : null;
      case 'project': {
        if (!workspaceId) return null;
        try {
          const project = await this.prisma.project.findFirst({
            where: { id: target.id, workspaceId, deletedAt: null },
            select: { id: true },
          });
          return project ? room : null;
        } catch (err) {
          this.logger.warn(`Kiểm quyền subscribe project thất bại: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }
      default:
        return null;
    }
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

  @OnEvent(DOMAIN_EVENTS.NOTIFICATION_CREATED)
  onNotificationCreated(p: { recipientId?: string; notification: unknown }) {
    if (!p?.recipientId || !this.server) return;
    this.server.to(rooms.user(p.recipientId)).emit(WS_EVENTS.NOTIFICATION_NEW, { notification: p.notification });
  }

  @OnEvent(DOMAIN_EVENTS.SPRINT_STARTED)
  onSprintStarted(p: { sprintId: string; projectId?: string }) {
    this.emitSprintUpdated(p);
  }

  @OnEvent(DOMAIN_EVENTS.SPRINT_COMPLETED)
  onSprintCompleted(p: { sprintId: string; projectId?: string }) {
    this.emitSprintUpdated(p);
  }

  @OnEvent(DOMAIN_EVENTS.SPRINT_UPDATED)
  onSprintUpdated(p: { sprintId: string; projectId?: string }) {
    this.emitSprintUpdated(p);
  }

  private emitSprintUpdated(p: { sprintId: string; projectId?: string }) {
    if (!p?.sprintId) return;
    this.toProject(p.projectId, WS_EVENTS.SPRINT_UPDATED, { sprintId: p.sprintId, projectId: p.projectId });
  }
}
