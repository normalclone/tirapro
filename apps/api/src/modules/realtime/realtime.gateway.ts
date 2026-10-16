import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { DOMAIN_EVENTS, WS_EVENTS, rooms } from '@tirapro/types';
import type { CommentDto, IssueDto, NotificationDto } from '@tirapro/types';
import type {
  ClientToServerEvents,
  IssueMovedPayload,
  RoomTarget,
  ServerToClientEvents,
  SubscribeAck,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PresenceService, type PresenceProfile } from './presence.service';
import { isSessionRevoked } from '../auth/session-revocation';

/** Thời điểm cấp access token (để so với `sessionsRevokedAt`). */
type TokenIssued = { iat?: number; iatMs?: number };

/** Room issue hợp lệ cho `presence:view` / `typing:*` (tên do client gửi nên phải kiểm dạng). */
const ISSUE_ROOM_RE = /^issue:[A-Za-z0-9_-]+$/;

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * Socket.io gateway: xác thực JWT ở handshake, kiểm quyền khi subscribe room, và RealtimeBridge
 * (@OnEvent domain events → broadcast). CORS và Redis adapter (scale-out nhiều node) được cấu hình
 * ở RedisIoAdapter (main.ts) vì decorator này không đọc được config lúc chạy.
 */
@WebSocketGateway({ path: '/realtime' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: TypedServer;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  /**
   * Xác thực JWT rồi kiểm lại với DB: user còn ACTIVE và (trừ system admin) vẫn là thành viên workspace
   * trong token. Token còn hạn của người đã bị gỡ/khoá KHÔNG được nhận realtime. Thất bại → ngắt kết nối.
   */
  async handleConnection(client: TypedSocket): Promise<void> {
    try {
      const raw =
        (client.handshake.auth?.token as string) ||
        String(client.handshake.headers.authorization ?? '').replace('Bearer ', '');
      const payload = this.jwt.verify<{
        sub: string;
        workspaceId: string | null;
        iat?: number;
        iatMs?: number;
      }>(raw, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      // Gán ngay (đồng bộ) để subscribe đến sớm vẫn có danh tính; mỗi lần subscribe sẽ kiểm membership lại.
      const data = client.data as {
        userId?: string;
        workspaceId?: string | null;
        iat?: number;
        iatMs?: number;
      };
      data.userId = payload.sub;
      data.workspaceId = payload.workspaceId;
      // Giữ mốc cấp token: mỗi lần subscribe kiểm lại với `sessionsRevokedAt` như guard HTTP.
      data.iat = payload.iat;
      data.iatMs = payload.iatMs;
      // Vào room user TRƯỚC khi kiểm: sự kiện thu hồi phiên tới giữa hai bước vẫn ngắt được socket này
      // (nếu chưa join, event lọt qua; còn kiểm sau thì `hasAccess` thấy mốc thu hồi). Chưa được cấp quyền gì khác ở bước này.
      await client.join(rooms.user(payload.sub));
      if (!(await this.hasAccess(payload.sub, payload.workspaceId, payload))) {
        client.disconnect(true);
        return;
      }
      if (payload.workspaceId) void client.join(rooms.workspace(payload.workspaceId));
    } catch {
      client.disconnect(true);
    }
  }

  /**
   * User còn ACTIVE và (trừ system admin) còn là thành viên workspace. Không có workspace trong token
   * thì chỉ cần ACTIVE (khi đó chỉ vào được room user của chính mình). Lỗi DB → từ chối (fail closed).
   */
  private async hasAccess(
    userId: string,
    workspaceId: string | null | undefined,
    issued: TokenIssued,
  ): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, isSystemAdmin: true, sessionsRevokedAt: true },
      });
      if (!user || user.status === 'DEACTIVATED') return false;
      // Token cấp trước mốc thu hồi phiên (đặt lại mật khẩu, đăng xuất mọi thiết bị…) không được mở/giữ socket.
      if (isSessionRevoked(issued, user.sessionsRevokedAt)) return false;
      if (!workspaceId || user.isSystemAdmin) return true;
      const membership = await this.prisma.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { id: true },
      });
      return membership != null;
    } catch (err) {
      this.logger.warn(
        `Kiểm membership realtime thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Chỉ cho vào room của chính mình: user = chính user, workspace = workspace của token,
   * project = project còn sống thuộc workspace của token. Mọi trường hợp khác trả FORBIDDEN.
   */
  @SubscribeMessage(WS_EVENTS.SUBSCRIBE)
  async onSubscribe(
    @MessageBody() target: RoomTarget,
    @ConnectedSocket() client: TypedSocket,
  ): Promise<SubscribeAck> {
    const room = await this.authorizeRoom(target, client);
    if (!room) return { ok: false, error: 'FORBIDDEN' };
    await client.join(room);
    // Presence chỉ bắt đầu SAU khi subscribe project đã được kiểm quyền.
    if (target.kind === 'project') await this.joinPresence(client, room);
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.UNSUBSCRIBE)
  async onUnsubscribe(
    @MessageBody() target: RoomTarget,
    @ConnectedSocket() client: TypedSocket,
  ): Promise<void> {
    const room = this.roomName(target);
    if (!room) return;
    await client.leave(room);
    if (target.kind === 'project') await this.leavePresence(client, room);
  }

  handleDisconnect(client: TypedSocket): void {
    // Rời mọi room presence socket này đã vào (data.rooms) — không chặn việc ngắt kết nối.
    for (const room of this.presenceRooms(client)) void this.leavePresence(client, room, true);
  }

  /**
   * Heartbeat + báo đang xem gì (`issue:<id>` hoặc null). Client gửi lại mỗi 25s nên cũng làm mới `ts`.
   * Chỉ phát lại `presence:state` cho room project khi `viewing` đổi thật.
   */
  @SubscribeMessage(WS_EVENTS.PRESENCE_VIEW)
  async onPresenceView(
    @MessageBody() body: { room?: string | null },
    @ConnectedSocket() client: TypedSocket,
  ): Promise<void> {
    const viewing =
      typeof body?.room === 'string' && ISSUE_ROOM_RE.test(body.room) ? body.room : null;
    const data = client.data as { userId?: string; viewing?: string | null };
    const userId = data.userId;
    if (!userId) return;
    // Nhớ lại để áp dụng ngay khi join presence xong (client có thể gửi view trước khi subscribe kịp xong).
    data.viewing = viewing;
    for (const room of this.presenceRooms(client)) {
      try {
        let res = await this.presence.setViewing(room, userId, viewing);
        if (!res) {
          // Entry đã hết hạn (mất mạng lâu / Redis khởi động lại) → vào lại rồi đặt viewing.
          await this.joinPresence(client, room);
          res = await this.presence.setViewing(room, userId, viewing);
        }
        if (res?.changed) {
          this.server
            .to(room)
            .emit(WS_EVENTS.PRESENCE_STATE, { room, users: await this.presence.state(room) });
        }
      } catch (err) {
        this.logger.warn(
          `presence:view thất bại: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  @SubscribeMessage(WS_EVENTS.TYPING_START)
  async onTypingStart(
    @MessageBody() body: { room?: string },
    @ConnectedSocket() client: TypedSocket,
  ): Promise<void> {
    await this.relayTyping(client, body?.room, true);
  }

  @SubscribeMessage(WS_EVENTS.TYPING_STOP)
  async onTypingStop(
    @MessageBody() body: { room?: string },
    @ConnectedSocket() client: TypedSocket,
  ): Promise<void> {
    await this.relayTyping(client, body?.room, false);
  }

  /** Relay `typing` tới room issue trừ người gửi; chỉ khi socket đã subscribe (đã kiểm quyền) room đó. */
  private async relayTyping(
    client: TypedSocket,
    room: string | undefined,
    typing: boolean,
  ): Promise<void> {
    if (typeof room !== 'string' || !ISSUE_ROOM_RE.test(room) || !client.rooms?.has(room)) return;
    const profile = await this.profileOf(client);
    if (!profile) return;
    client.to(room).emit(WS_EVENTS.TYPING, {
      room,
      userId: profile.userId,
      displayName: profile.displayName,
      typing,
    });
  }

  // ---------- Presence ----------
  /** Các room project mà socket đang tham gia presence (theo dõi trong client.data.rooms). */
  private presenceRooms(client: TypedSocket): string[] {
    const rooms = (client.data as { rooms?: string[] }).rooms;
    return Array.isArray(rooms) ? [...rooms] : [];
  }

  /** Thông tin hiển thị của user (cache ở client.data.profile); null nếu không đọc được. */
  private async profileOf(client: TypedSocket): Promise<PresenceProfile | null> {
    const data = client.data as { userId?: string; profile?: PresenceProfile };
    if (data.profile) return data.profile;
    if (!data.userId) return null;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
        select: { displayName: true, avatarUrl: true },
      });
      if (!user) return null;
      data.profile = {
        userId: data.userId,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
      };
      return data.profile;
    } catch (err) {
      this.logger.warn(
        `Đọc hồ sơ cho presence thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async joinPresence(client: TypedSocket, room: string): Promise<void> {
    try {
      const profile = await this.profileOf(client);
      if (!profile) return;
      const data = client.data as { rooms?: string[]; viewing?: string | null };
      const already = Array.isArray(data.rooms) && data.rooms.includes(room);
      if (!already) data.rooms = [...(data.rooms ?? []), room];
      let user = await this.presence.join(room, profile);
      if (data.viewing)
        user = (await this.presence.setViewing(room, profile.userId, data.viewing))?.user ?? user;
      if (!already) client.to(room).emit(WS_EVENTS.PRESENCE_JOIN, { room, user });
      client.emit(WS_EVENTS.PRESENCE_STATE, { room, users: await this.presence.state(room) });
    } catch (err) {
      this.logger.warn(
        `Presence join thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Rời presence. Nếu cùng user còn socket khác (tab khác) trong room thì GIỮ entry để không làm
   * họ biến mất khỏi danh sách; `fromDisconnect` chỉ để bỏ qua việc kiểm tra thất bại.
   */
  private async leavePresence(
    client: TypedSocket,
    room: string,
    fromDisconnect = false,
  ): Promise<void> {
    const data = client.data as { userId?: string; rooms?: string[] };
    if (!Array.isArray(data.rooms) || !data.rooms.includes(room) || !data.userId) return;
    data.rooms = data.rooms.filter((r) => r !== room);
    try {
      if (await this.hasOtherSocketOfUser(room, data.userId, client.id)) return;
      await this.presence.leave(room, data.userId);
      this.server?.to(room).emit(WS_EVENTS.PRESENCE_LEAVE, { room, userId: data.userId });
    } catch (err) {
      if (!fromDisconnect)
        this.logger.warn(
          `Presence leave thất bại: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
  }

  private async hasOtherSocketOfUser(
    room: string,
    userId: string,
    selfId: string,
  ): Promise<boolean> {
    try {
      const sockets = await this.server.in(room).fetchSockets();
      return sockets.some(
        (s) => s.id !== selfId && (s.data as { userId?: string }).userId === userId,
      );
    } catch {
      return false;
    }
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
      case 'issue':
        return rooms.issue(target.id);
      default:
        return null;
    }
  }

  /** Trả tên room nếu client được phép vào, ngược lại null. */
  private async authorizeRoom(
    target: RoomTarget | undefined,
    client: TypedSocket,
  ): Promise<string | null> {
    const room = this.roomName(target);
    if (!room || !target) return null;
    const { userId, workspaceId, iat, iatMs } = client.data as {
      userId?: string;
      workspaceId?: string | null;
      iat?: number;
      iatMs?: number;
    };
    // Kiểm lại MỖI lần subscribe: member bị gỡ / user bị khoá / phiên bị thu hồi sau lúc handshake thì không vào thêm room nào.
    if (!userId || !(await this.hasAccess(userId, workspaceId, { iat, iatMs }))) return null;
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
          this.logger.warn(
            `Kiểm quyền subscribe project thất bại: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      }
      case 'issue': {
        if (!workspaceId) return null;
        try {
          const issue = await this.prisma.issue.findFirst({
            where: { id: target.id, workspaceId, deletedAt: null },
            select: { id: true },
          });
          return issue ? room : null;
        } catch (err) {
          this.logger.warn(
            `Kiểm quyền subscribe issue thất bại: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      }
      default:
        return null;
    }
  }

  // ---------- RealtimeBridge: domain event -> broadcast ----------
  private toProject<E extends keyof ServerToClientEvents>(
    projectId: string | undefined,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ) {
    if (!projectId || !this.server) return;
    this.server.to(rooms.project(projectId)).emit(event, ...args);
  }

  /** Member bị gỡ khỏi workspace → ngắt mọi socket của họ trong workspace đó (room ws:<id>), kể cả node khác. */
  @OnEvent(DOMAIN_EVENTS.MEMBER_REMOVED)
  async onMemberRemoved(p: { workspaceId?: string; userId?: string }) {
    if (!p?.workspaceId || !p?.userId || !this.server) return;
    try {
      const sockets = await this.server.in(rooms.workspace(p.workspaceId)).fetchSockets();
      for (const s of sockets) {
        if ((s.data as { userId?: string }).userId === p.userId) s.disconnect(true);
      }
    } catch (err) {
      this.logger.warn(
        `Ngắt socket của member bị gỡ thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Phiên của user bị thu hồi (khoá / đặt lại mật khẩu / đăng xuất mọi thiết bị / đổi mật khẩu) → ngắt socket của họ.
   * `in(room).disconnectSockets` đi qua Redis adapter nên ngắt cả socket đang ở node khác.
   * Có `revokedAtMs` (vd tự đổi mật khẩu): chỉ ngắt socket mang token cấp TRƯỚC mốc đó — socket mới của thiết bị đang đổi
   * (token mới) được giữ, kể cả khi nó nối lại trước lúc sự kiện tới node này.
   */
  @OnEvent(DOMAIN_EVENTS.ACCOUNT_SESSIONS_REVOKED)
  async onSessionsRevoked(p: { userId?: string; revokedAtMs?: number }): Promise<void> {
    if (!p?.userId || !this.server) return;
    try {
      const room = this.server.in(rooms.user(p.userId));
      if (p.revokedAtMs == null) {
        room.disconnectSockets(true);
        return;
      }
      const revokedAt = new Date(p.revokedAtMs);
      for (const s of await room.fetchSockets()) {
        const d = s.data as { iat?: number; iatMs?: number };
        if (isSessionRevoked(d, revokedAt)) s.disconnect(true);
      }
    } catch (err) {
      this.logger.warn(
        `Ngắt socket của phiên bị thu hồi thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_CREATED)
  onIssueCreated(p: { issue: IssueDto }) {
    this.toProject(p.issue?.projectId, WS_EVENTS.ISSUE_CREATED, { issue: p.issue });
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_UPDATED)
  onIssueUpdated(p: { issue: IssueDto }) {
    this.toProject(p.issue?.projectId, WS_EVENTS.ISSUE_UPDATED, { issue: p.issue });
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_TRANSITIONED)
  onIssueTransitioned(p: { issue: IssueDto }) {
    this.toProject(p.issue?.projectId, WS_EVENTS.ISSUE_UPDATED, { issue: p.issue });
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_MOVED)
  onIssueMoved(p: IssueMovedPayload) {
    this.toProject(p.projectId, WS_EVENTS.ISSUE_MOVED, p);
  }

  @OnEvent(DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED)
  onProjectRanksRebalanced(p: { projectId?: string }) {
    if (!p?.projectId) return;
    this.toProject(p.projectId, WS_EVENTS.PROJECT_RANKS_REBALANCED, { projectId: p.projectId });
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_DELETED)
  onIssueDeleted(p: { issueId: string; projectId?: string }) {
    if (!p.projectId) return;
    this.toProject(p.projectId, WS_EVENTS.ISSUE_DELETED, {
      issueId: p.issueId,
      projectId: p.projectId,
    });
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_ADDED)
  onCommentAdded(p: { comment: CommentDto; projectId?: string; issueId: string }) {
    this.toProject(p.projectId, WS_EVENTS.COMMENT_ADDED, { comment: p.comment });
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_UPDATED)
  onCommentUpdated(p: { comment: CommentDto; projectId?: string; issueId: string }) {
    this.toProject(p.projectId, WS_EVENTS.COMMENT_UPDATED, { comment: p.comment });
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_DELETED)
  onCommentDeleted(p: { commentId: string; issueId: string; projectId?: string }) {
    this.toProject(p.projectId, WS_EVENTS.COMMENT_DELETED, {
      commentId: p.commentId,
      issueId: p.issueId,
    });
  }

  @OnEvent(DOMAIN_EVENTS.NOTIFICATION_CREATED)
  onNotificationCreated(p: { recipientId?: string; notification: NotificationDto }) {
    if (!p?.recipientId || !this.server) return;
    this.server
      .to(rooms.user(p.recipientId))
      .emit(WS_EVENTS.NOTIFICATION_NEW, { notification: p.notification });
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
    if (!p?.sprintId || !p.projectId) return;
    this.toProject(p.projectId, WS_EVENTS.SPRINT_UPDATED, {
      sprintId: p.sprintId,
      projectId: p.projectId,
    });
  }
}
