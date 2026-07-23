# Realtime Collaboration

I'll write the design specification directly. This is a documentation task focused on the Realtime Collaboration subsystem, so I'll produce the complete markdown spec as my return value.

# Đặc Tả Thiết Kế Subsystem: Realtime Collaboration (Socket.io)

> **Tirapro** — Jira clone + nâng cấp. Subsystem này phụ trách toàn bộ realtime: gateway NestJS, auth socket bằng JWT, rooms, events, presence, typing indicators, broadcast, optimistic UI + conflict reconciliation ở client, và scaling bằng Redis adapter.

---

## 1. Tổng Quan Kiến Trúc

### 1.1 Mục tiêu

- Đẩy mọi thay đổi domain (issue create/update/move, comment, sprint…) tới các client đang xem **realtime**, độ trễ < 150ms trong cùng region.
- **Presence**: biết ai đang online trong project, ai đang xem issue nào, ai đang gõ comment.
- **Optimistic UI**: client cập nhật TanStack Query cache ngay khi user thao tác, sau đó reconcile với event server gửi về (kể cả event do chính mình gây ra) — idempotent.
- **Conflict handling**: phát hiện stale write bằng `version` (optimistic concurrency control), giải quyết bằng last-write-wins + thông báo + field-level merge khi có thể.
- **Scale-out**: nhiều instance NestJS phía sau load balancer dùng **Redis adapter** để broadcast cross-instance.

### 1.2 Sơ đồ luồng

```
┌──────────┐   WS (JWT in handshake)   ┌─────────────────────────────────┐
│ Browser  │ ─────────────────────────▶│  NestJS instance #1             │
│ (React + │ ◀──── events ─────────────│  ┌───────────────────────────┐  │
│ socket.io│                           │  │ RealtimeGateway           │  │
│ -client) │                           │  │  - WsJwtGuard (handshake) │  │
└──────────┘                           │  │  - Rooms / Presence svc   │  │
                                       │  └───────────────────────────┘  │
                                       └───────────────┬─────────────────┘
                                                       │ @socket.io/redis-adapter
                                       ┌───────────────▼─────────────────┐
                                       │            Redis                │
                                       │  - pub/sub (adapter)            │
                                       │  - presence sets (TTL)          │
                                       │  - typing keys (TTL)            │
                                       └───────────────▲─────────────────┘
                                                       │
                                       ┌───────────────┴─────────────────┐
                                       │  NestJS instance #2 ... #N      │
                                       └─────────────────────────────────┘
                       ▲
                       │  RealtimeService.emit*()  (gọi từ domain services
                       │  qua EventEmitter2 / direct injection)
            ┌──────────┴───────────┐
            │ IssuesService, Comments,│
            │ SprintsService, Board... │  ← subsystem khác phát domain events
            └────────────────────────┘
```

**Nguyên tắc cốt lõi**: Gateway **không** chứa business logic. Domain services (Issues, Comments, Sprints…) là source of truth, ghi DB xong thì phát một **domain event** (qua `@nestjs/event-emitter`). Một `RealtimeBridge` listener nhận domain event và gọi `RealtimeService` để broadcast vào đúng room. Điều này giữ gateway mỏng, dễ test, tránh circular dependency.

---

## 2. Cấu Trúc Thư Mục (backend)

```
apps/api/src/realtime/
├── realtime.module.ts          # @Global() để các module domain dùng RealtimeService
├── realtime.gateway.ts         # @WebSocketGateway — handle connect/disconnect & client→server events
├── realtime.service.ts         # API nội bộ để domain services broadcast (emitToRoom...)
├── realtime.bridge.ts          # @OnEvent listeners: domain event → broadcast
├── guards/
│   └── ws-jwt.guard.ts         # xác thực JWT cho cả handshake lẫn message guard
├── presence/
│   ├── presence.service.ts     # online users + issue viewers (Redis-backed)
│   └── typing.service.ts       # typing indicators (Redis TTL)
├── rooms/
│   └── room.util.ts            # hàm chuẩn hoá tên room
├── adapters/
│   └── redis-io.adapter.ts     # IoAdapter custom gắn Redis adapter
├── dto/
│   ├── subscribe.dto.ts
│   ├── typing.dto.ts
│   └── viewing.dto.ts
├── events/
│   ├── server-events.enum.ts   # tên event server→client
│   └── client-events.enum.ts   # tên event client→server
└── types/
    └── realtime.types.ts       # SocketData, payload interfaces (shared với FE qua packages/shared)
```

> Các interface payload **phải** đặt ở `packages/shared` (workspace pnpm) để FE & BE dùng chung type, tránh drift. Ví dụ `packages/shared/src/realtime.ts`.

---

## 3. Authentication Socket (JWT)

### 3.1 Chiến lược

- Client gửi **access token** trong handshake (`auth.token`), KHÔNG đặt trong query string (tránh log lộ token).
- Gateway xác thực **một lần ở handshake** (`handleConnection`). Token hợp lệ → lưu `userId`, `orgId`, `roles`, `email` vào `socket.data`. Token sai/hết hạn → `socket.disconnect()` với lý do.
- **Refresh token KHÔNG đi qua socket.** Khi access token hết hạn giữa phiên, client refresh qua REST (`POST /auth/refresh`) rồi gọi `socket.disconnect()` + reconnect với token mới (socket.io-client tự reconnect; ta cập nhật `auth.token` trước khi reconnect).
- Mọi message client→server đi qua `WsJwtGuard` để re-validate (chặn token đã bị revoke giữa chừng — kiểm tra `tokenVersion` / blacklist nếu có).

### 3.2 Handshake auth (client)

```ts
// apps/web/src/lib/socket.ts
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(import.meta.env.VITE_WS_URL, {
    transports: ['websocket'],          // ép websocket, bỏ polling cho perf
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
  });
  return socket;
}
```

`auth` dạng callback ⇒ mỗi lần reconnect socket.io gọi lại để lấy token **mới nhất** (quan trọng sau khi refresh).

### 3.3 Guard & gateway (server)

```ts
// guards/ws-jwt.guard.ts
@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const client = ctx.switchToWs().getClient<Socket>();
    const token = WsJwtGuard.extractToken(client);
    if (!token) throw new WsException('UNAUTHENTICATED');
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
      client.data.user = {
        userId: payload.sub,
        orgId: payload.orgId,
        email: payload.email,
        roles: payload.roles ?? [],
        tokenVersion: payload.tv,
      };
      return true;
    } catch {
      throw new WsException('TOKEN_INVALID');
    }
  }

  static extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    if (fromAuth) return fromAuth;
    const header = client.handshake.headers?.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : null;
  }
}
```

```ts
// realtime.gateway.ts (phần connect)
@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN?.split(','), credentials: true },
  // namespace mặc định '/'; nếu muốn tách: namespace: '/rt'
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly presence: PresenceService,
    private readonly access: ProjectAccessService, // từ subsystem RBAC
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = WsJwtGuard.extractToken(client);
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
      client.data.user = {
        userId: payload.sub, orgId: payload.orgId,
        email: payload.email, roles: payload.roles ?? [],
      };
      // auto-join org room (mọi event org-wide như notification badge)
      await client.join(Room.org(payload.orgId));
      // join personal room để gửi event riêng cho user trên mọi tab
      await client.join(Room.user(payload.sub));
      await this.presence.onConnect(payload.sub, payload.orgId, client.id);
      this.logger.log(`connected ${payload.sub} (${client.id})`);
    } catch (e) {
      this.logger.warn(`reject socket ${client.id}: ${e.message}`);
      client.emit('connect:error', { code: 'UNAUTHENTICATED' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (!user) return;
    await this.presence.onDisconnect(user.userId, user.orgId, client.id);
  }
}
```

> **Điểm giao tiếp với Auth subsystem**: dùng chung `JwtService` + `JWT_ACCESS_SECRET`, cùng cấu trúc claim (`sub`, `orgId`, `roles`, `tv`). **Điểm giao tiếp với RBAC subsystem**: `ProjectAccessService.canAccessProject(userId, projectId)` được gọi trước khi cho join project/board/issue room (mục 4.3).

---

## 4. Mô Hình Rooms

### 4.1 Quy ước đặt tên

Room name là string namespaced bằng `:` — dễ debug, dễ pattern khi cleanup.

| Room | Pattern | Ai join | Mục đích |
|------|---------|---------|----------|
| Org | `org:{orgId}` | auto khi connect | org-wide notification, member online count |
| User (personal) | `user:{userId}` | auto khi connect | gửi riêng cho 1 user trên mọi tab/thiết bị (notifications, mention) |
| Project | `project:{projectId}` | khi mở project | activity, member presence trong project |
| Board | `board:{boardId}` | khi mở board (Kanban/Scrum) | issue move/reorder cột, card update |
| Backlog | `backlog:{projectId}` | khi mở backlog | issue thêm/xoá/sắp xếp backlog, sprint thay đổi |
| Issue | `issue:{issueId}` | khi mở issue detail | comment, field update, attachment, typing, viewers |
| Sprint | `sprint:{sprintId}` | khi mở sprint/board scrum | sprint start/complete, scope change |

```ts
// rooms/room.util.ts
export const Room = {
  org: (id: string) => `org:${id}`,
  user: (id: string) => `user:${id}`,
  project: (id: string) => `project:${id}`,
  board: (id: string) => `board:${id}`,
  backlog: (projectId: string) => `backlog:${projectId}`,
  issue: (id: string) => `issue:${id}`,
  sprint: (id: string) => `sprint:${id}`,
} as const;
```

### 4.2 Hierarchy & broadcast strategy

Rooms **độc lập** (không lồng nhau ở socket.io). Khi một issue đổi cột trên board, server broadcast tới **cả** `board:{boardId}` (cập nhật vị trí card) **lẫn** `issue:{issueId}` (cập nhật field status nếu ai đang mở detail). `RealtimeService` chịu trách nhiệm fan-out tới nhiều room trong 1 lần emit (mục 6).

### 4.3 Subscribe có kiểm tra quyền

Client KHÔNG được tự ý join room bất kỳ. Mọi subscribe đi qua handler `client:subscribe` có RBAC check:

```ts
// realtime.gateway.ts
@UseGuards(WsJwtGuard)
@SubscribeMessage(ClientEvent.SUBSCRIBE)
async onSubscribe(
  @ConnectedSocket() client: Socket,
  @MessageBody() dto: SubscribeDto, // { scope: 'project'|'board'|'issue'|'backlog'|'sprint', id }
): Promise<WsAck> {
  const { userId } = client.data.user;
  const projectId = await this.access.resolveProjectId(dto.scope, dto.id);
  const ok = await this.access.canAccessProject(userId, projectId);
  if (!ok) return { ok: false, error: 'FORBIDDEN' };

  const room = Room[dto.scope](dto.id);
  await client.join(room);

  // side-effects theo scope
  if (dto.scope === 'project') {
    const members = await this.presence.getOnline(projectId);
    client.emit(ServerEvent.PRESENCE_SYNC, { projectId, members });
  }
  if (dto.scope === 'issue') {
    await this.presence.startViewing(userId, dto.id, client.id);
    const viewers = await this.presence.getViewers(dto.id);
    this.server.to(Room.issue(dto.id)).emit(ServerEvent.ISSUE_VIEWERS, { issueId: dto.id, viewers });
  }
  return { ok: true, room };
}

@UseGuards(WsJwtGuard)
@SubscribeMessage(ClientEvent.UNSUBSCRIBE)
async onUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() dto: SubscribeDto) {
  const room = Room[dto.scope](dto.id);
  await client.leave(room);
  if (dto.scope === 'issue') {
    await this.presence.stopViewing(client.data.user.userId, dto.id, client.id);
    const viewers = await this.presence.getViewers(dto.id);
    this.server.to(room).emit(ServerEvent.ISSUE_VIEWERS, { issueId: dto.id, viewers });
  }
  return { ok: true };
}
```

> **WsAck**: tất cả client→server message dùng acknowledgement callback `(ack) => ...` để client biết subscribe thành công/thất bại (xử lý lỗi FORBIDDEN, hiển thị toast).

---

## 5. Danh Sách Events Đầy Đủ & Payload

### 5.1 Enum tên event

```ts
// events/client-events.enum.ts  (client → server)
export enum ClientEvent {
  SUBSCRIBE        = 'client:subscribe',
  UNSUBSCRIBE      = 'client:unsubscribe',
  ISSUE_VIEW       = 'client:issue:view',      // bắt đầu xem (presence viewer)
  ISSUE_UNVIEW     = 'client:issue:unview',
  TYPING_START     = 'client:typing:start',
  TYPING_STOP      = 'client:typing:stop',
  PRESENCE_PING    = 'client:presence:ping',    // heartbeat tuỳ chọn
}

// events/server-events.enum.ts (server → client)
export enum ServerEvent {
  CONNECT_ERROR     = 'connect:error',
  // Issue
  ISSUE_CREATED     = 'issue:created',
  ISSUE_UPDATED     = 'issue:updated',
  ISSUE_MOVED       = 'issue:moved',       // đổi cột/status (board)
  ISSUE_REORDERED   = 'issue:reordered',   // đổi thứ tự trong cùng cột/backlog
  ISSUE_DELETED     = 'issue:deleted',
  ISSUE_ASSIGNED    = 'issue:assigned',
  // Comment
  COMMENT_CREATED   = 'comment:created',
  COMMENT_UPDATED   = 'comment:updated',
  COMMENT_DELETED   = 'comment:deleted',
  // Attachment
  ATTACHMENT_ADDED  = 'attachment:added',
  ATTACHMENT_REMOVED= 'attachment:removed',
  // Sprint / board
  SPRINT_STARTED    = 'sprint:started',
  SPRINT_COMPLETED  = 'sprint:completed',
  SPRINT_UPDATED    = 'sprint:updated',
  BACKLOG_CHANGED   = 'backlog:changed',
  // Presence & collab
  PRESENCE_SYNC     = 'presence:sync',     // full snapshot khi join
  PRESENCE_JOIN     = 'presence:join',
  PRESENCE_LEAVE    = 'presence:leave',
  ISSUE_VIEWERS     = 'issue:viewers',
  TYPING            = 'typing',
  // Cross-cutting
  NOTIFICATION      = 'notification:new',
  ACTIVITY          = 'activity:new',
  CONFLICT          = 'conflict:detected',
}
```

### 5.2 Bảng event server → client

| Event | Room đích | Trigger (domain) | Payload (TS interface) |
|-------|-----------|------------------|------------------------|
| `issue:created` | `project`, `board`, `backlog` | IssuesService.create | `IssueCreatedPayload` |
| `issue:updated` | `issue`, `board` | IssuesService.update (field change) | `IssueUpdatedPayload` |
| `issue:moved` | `board`, `issue` | BoardService.moveCard | `IssueMovedPayload` |
| `issue:reordered` | `board`/`backlog` | reorder trong cột/backlog | `IssueReorderedPayload` |
| `issue:deleted` | `project`,`board`,`backlog`,`issue` | IssuesService.remove | `{ issueId, projectId, actor }` |
| `issue:assigned` | `issue`,`board`,`user:{assignee}` | assign | `IssueAssignedPayload` |
| `comment:created` | `issue` | CommentsService.create | `CommentPayload` |
| `comment:updated` | `issue` | CommentsService.update | `CommentPayload` |
| `comment:deleted` | `issue` | CommentsService.remove | `{ commentId, issueId, actor }` |
| `attachment:added` | `issue` | AttachmentsService.add | `AttachmentPayload` |
| `sprint:started` / `:completed` / `:updated` | `sprint`,`board`,`backlog` | SprintsService | `SprintPayload` |
| `backlog:changed` | `backlog` | reorder/move sprint↔backlog | `BacklogChangedPayload` |
| `presence:sync` | socket cá nhân | sau subscribe project | `{ projectId, members: PresenceUser[] }` |
| `presence:join`/`:leave` | `project` | connect/disconnect/subscribe | `{ projectId, user: PresenceUser }` |
| `issue:viewers` | `issue` | start/stop viewing | `{ issueId, viewers: PresenceUser[] }` |
| `typing` | `issue` | typing start/stop (debounced) | `TypingPayload` |
| `notification:new` | `user:{id}` | NotificationsService | `NotificationPayload` |
| `activity:new` | `project`,`issue` | ActivityLogService | `ActivityPayload` |
| `conflict:detected` | socket cá nhân (ack) | version mismatch | `ConflictPayload` |

### 5.3 Định nghĩa payload (đặt ở `packages/shared`)

```ts
// packages/shared/src/realtime.ts
export interface ActorRef { id: string; name: string; avatarUrl?: string | null; }

interface BaseEvent {
  eventId: string;       // uuid — dedupe ở client
  ts: string;            // ISO8601
  actor: ActorRef;       // ai gây ra
  origin?: string;       // socket.id của client gốc → bỏ qua khi self-echo (optional)
}

export interface IssueDTO {
  id: string; key: string;          // "PROJ-123"
  projectId: string; boardId?: string | null;
  type: 'EPIC'|'STORY'|'TASK'|'BUG'|'SUBTASK';
  title: string; statusId: string; status: string;
  assigneeId?: string | null; priority: string;
  storyPoints?: number | null;
  rank: string;                      // LexoRank cho ordering
  version: number;                   // OCC — tăng mỗi update
  updatedAt: string;
}

export interface IssueCreatedPayload extends BaseEvent { issue: IssueDTO; }

export interface IssueUpdatedPayload extends BaseEvent {
  issueId: string;
  changes: Partial<IssueDTO>;        // chỉ field đổi (field-level)
  version: number;                   // version mới sau update
  prevVersion: number;               // version trước đó → client validate tuần tự
}

export interface IssueMovedPayload extends BaseEvent {
  issueId: string; boardId: string;
  from: { statusId: string; rank: string };
  to:   { statusId: string; rank: string };
  version: number; prevVersion: number;
}

export interface IssueReorderedPayload extends BaseEvent {
  issueId: string; containerId: string;   // statusId hoặc 'backlog'
  rank: string; version: number;
}

export interface IssueAssignedPayload extends BaseEvent {
  issueId: string; assignee: ActorRef | null; version: number;
}

export interface CommentPayload extends BaseEvent {
  comment: {
    id: string; issueId: string; body: string;   // rich text / markdown
    authorId: string; mentions: string[];          // userIds
    createdAt: string; updatedAt: string; editedAt?: string | null;
  };
}

export interface AttachmentPayload extends BaseEvent {
  attachment: { id: string; issueId: string; filename: string; url: string; size: number; mime: string; };
}

export interface SprintPayload extends BaseEvent {
  sprint: { id: string; projectId: string; name: string; state: 'FUTURE'|'ACTIVE'|'COMPLETED'; startDate?: string; endDate?: string; goal?: string; };
}

export interface BacklogChangedPayload extends BaseEvent {
  projectId: string;
  op: 'add'|'remove'|'reorder'|'move-to-sprint'|'move-to-backlog';
  issueId: string; sprintId?: string | null; rank?: string;
}

// Presence
export interface PresenceUser {
  userId: string; name: string; avatarUrl?: string | null;
  status: 'online'|'away';
  viewingIssueId?: string | null;
  connections: number;             // số tab/thiết bị đang mở
}

export interface TypingPayload {
  issueId: string; user: ActorRef; isTyping: boolean;
}

export interface NotificationPayload extends BaseEvent {
  notification: { id: string; type: string; title: string; body: string; link: string; read: boolean; };
}

export interface ActivityPayload extends BaseEvent {
  activity: { id: string; projectId: string; issueId?: string; verb: string; summary: string; };
}

export interface ConflictPayload {
  resource: 'issue'|'comment';
  resourceId: string;
  yourVersion: number;
  currentVersion: number;
  current: Partial<IssueDTO>;       // state mới nhất từ server để client reconcile
}

export interface WsAck { ok: boolean; room?: string; error?: string; conflict?: ConflictPayload; }
```

---

## 6. RealtimeService — API broadcast nội bộ

Domain services KHÔNG gọi trực tiếp `server.to().emit()`. Chúng phát domain event; `RealtimeBridge` lắng nghe và gọi `RealtimeService`. Điều này cho phép tách realtime ra khỏi transaction DB (broadcast **sau** khi commit thành công).

```ts
// realtime.service.ts
@Injectable()
export class RealtimeService {
  constructor(@Inject('SOCKET_SERVER') private readonly server: Server) {}

  /** Fan-out tới nhiều room cùng lúc, dedupe room trùng. */
  emitToRooms(rooms: string[], event: ServerEvent, payload: unknown) {
    const unique = [...new Set(rooms)];
    this.server.to(unique).emit(event, payload);
  }

  emitToUser(userId: string, event: ServerEvent, payload: unknown) {
    this.server.to(Room.user(userId)).emit(event, payload);
  }

  /** Loại trừ socket gốc (nếu muốn — mặc định KHÔNG loại, xem mục 8.2). */
  emitExcept(rooms: string[], originSocketId: string, event: ServerEvent, payload: unknown) {
    this.server.to([...new Set(rooms)]).except(originSocketId).emit(event, payload);
  }
}
```

```ts
// realtime.bridge.ts  — kết nối domain events ↔ realtime
@Injectable()
export class RealtimeBridge {
  constructor(private readonly rt: RealtimeService) {}

  @OnEvent('issue.created', { async: true })
  onIssueCreated(e: IssueCreatedEvent) {
    const payload: IssueCreatedPayload = { ...base(e), issue: e.issue };
    this.rt.emitToRooms(
      [Room.project(e.issue.projectId), Room.backlog(e.issue.projectId),
       e.issue.boardId ? Room.board(e.issue.boardId) : ''].filter(Boolean),
      ServerEvent.ISSUE_CREATED, payload,
    );
  }

  @OnEvent('issue.moved', { async: true })
  onIssueMoved(e: IssueMovedEvent) {
    const payload: IssueMovedPayload = { ...base(e), ...e };
    this.rt.emitToRooms(
      [Room.board(e.boardId), Room.issue(e.issueId)],
      ServerEvent.ISSUE_MOVED, payload,
    );
  }

  @OnEvent('comment.created', { async: true })
  onComment(e: CommentCreatedEvent) {
    this.rt.emitToRooms([Room.issue(e.comment.issueId)], ServerEvent.COMMENT_CREATED, { ...base(e), comment: e.comment });
    // mention → notification cá nhân
    for (const uid of e.comment.mentions) {
      this.rt.emitToUser(uid, ServerEvent.NOTIFICATION, buildMentionNotif(e, uid));
    }
  }
  // ... issue.updated, issue.deleted, sprint.*, attachment.* tương tự
}
```

> **Điểm giao tiếp với mọi subsystem domain**: chúng chỉ cần `eventEmitter.emit('issue.moved', payloadEvent)` sau khi commit. Hợp đồng (contract) là tên event + shape của `*Event` class trong `packages/shared`. Realtime subsystem sở hữu bridge, KHÔNG cần domain biết về Socket.io.

---

## 7. Presence

### 7.1 Mô hình dữ liệu (Redis)

Presence phải chia sẻ cross-instance ⇒ lưu ở Redis, KHÔNG lưu in-memory.

| Key | Type | TTL | Ý nghĩa |
|-----|------|-----|---------|
| `presence:org:{orgId}` | Hash `userId → connCount` | — | đếm số connection mỗi user (multi-tab) |
| `presence:conn:{socketId}` | String `userId` | 60s (refresh by ping) | map socket → user, dọn khi crash |
| `viewers:issue:{issueId}` | Set `userId` | — | ai đang xem issue |
| `viewing:user:{userId}` | String `issueId` | 120s | issue user đang xem (để build PresenceUser) |
| `typing:issue:{issueId}` | Hash `userId → ts` | field tự hết qua cleanup | ai đang gõ |

Multi-tab: dùng **connCount**. `onConnect` → `HINCRBY presence:org +1`; `onDisconnect` → `HINCRBY -1`, nếu về 0 thì broadcast `presence:leave` và `HDEL`.

```ts
// presence/presence.service.ts (rút gọn)
@Injectable()
export class PresenceService {
  constructor(@Inject('REDIS') private redis: Redis, private rt: RealtimeService, private users: UsersService) {}

  async onConnect(userId: string, orgId: string, socketId: string) {
    const n = await this.redis.hincrby(`presence:org:${orgId}`, userId, 1);
    await this.redis.set(`presence:conn:${socketId}`, userId, 'EX', 60);
    if (n === 1) {
      const user = await this.users.getRef(userId);
      this.rt.emitToRooms([Room.org(orgId)], ServerEvent.PRESENCE_JOIN, { user: { ...user, status: 'online', connections: 1 } });
    }
  }

  async onDisconnect(userId: string, orgId: string, socketId: string) {
    await this.redis.del(`presence:conn:${socketId}`);
    const n = await this.redis.hincrby(`presence:org:${orgId}`, userId, -1);
    if (n <= 0) {
      await this.redis.hdel(`presence:org:${orgId}`, userId);
      await this.redis.del(`viewing:user:${userId}`);
      this.rt.emitToRooms([Room.org(orgId)], ServerEvent.PRESENCE_LEAVE, { userId });
    }
  }

  async startViewing(userId: string, issueId: string, socketId: string) {
    await this.redis.sadd(`viewers:issue:${issueId}`, userId);
    await this.redis.set(`viewing:user:${userId}`, issueId, 'EX', 120);
  }
  async getViewers(issueId: string): Promise<PresenceUser[]> { /* SMEMBERS + hydrate */ }
}
```

### 7.2 Heartbeat & cleanup

- Socket.io tự có `pingInterval`/`pingTimeout`. Ta thêm `client:presence:ping` mỗi 30s từ client để refresh TTL của `presence:conn` và `viewing:user` (chống stale khi process bị kill cứng).
- Cron/`@Interval(60000)` quét key `presence:conn:*` hết hạn → reconcile connCount (defensive). Với scale lớn, dùng Redis keyspace notification thay vì scan.

### 7.3 UI presence (client)

- **Project header**: avatar stack những người online (`presence:sync` + `join`/`leave`).
- **Issue detail**: "đang xem" avatars từ `issue:viewers`.
- **Board**: chấm xanh trên avatar assignee nếu online.

---

## 8. Typing Indicators (comment)

### 8.1 Luồng

```
User gõ → debounce 300ms → emit client:typing:start { issueId }
  → server set typing:issue:{issueId}[userId]=now, broadcast typing {isTyping:true} tới issue room (except sender)
Ngừng gõ 3s HOẶC blur HOẶC submit → emit client:typing:stop
  → server HDEL, broadcast typing {isTyping:false}
```

```ts
@UseGuards(WsJwtGuard)
@SubscribeMessage(ClientEvent.TYPING_START)
async onTypingStart(@ConnectedSocket() c: Socket, @MessageBody() d: TypingDto) {
  await this.typing.start(c.data.user.userId, d.issueId);
  const user = await this.users.getRef(c.data.user.userId);
  c.to(Room.issue(d.issueId)).emit(ServerEvent.TYPING, { issueId: d.issueId, user, isTyping: true });
}
```

> Dùng `c.to(room)` (KHÔNG `this.server.to`) để **tự loại trừ** chính sender — typing của mình không cần echo lại. Typing là ephemeral: KHÔNG ghi DB, KHÔNG cần idempotency.

### 8.2 Client (React)

```ts
// hook useTyping
const emitTyping = useMemo(() => debounce((on: boolean) => {
  socket.emit(on ? ClientEvent.TYPING_START : ClientEvent.TYPING_STOP, { issueId });
}, 300), [issueId]);

// onChange textarea: emitTyping(true); reset 3s timer → emitTyping(false)
```

---

## 9. Optimistic UI + Conflict Handling (client)

### 9.1 Nguyên tắc

- **Source of truth**: TanStack Query cache. Mọi mutation user-initiated dùng optimistic update qua `onMutate`.
- **Server REST trả về** entity mới với `version`. **Socket event** cũng mang `version`. Cả hai cùng đổ vào một **reconcile function** idempotent.
- **Dedupe & self-echo**: mỗi event có `eventId`. Client giữ một LRU set `seenEventIds` (size ~500). Event do chính mình gây ra: REST response đã cập nhật cache với version đúng; khi socket echo về, reconcile thấy version `<=` version hiện tại ⇒ no-op. Không cần loại self-echo ở server (đơn giản hoá, đảm bảo eventual consistency trên mọi tab cùng user).

### 9.2 Optimistic move card (Kanban) — ví dụ đầy đủ

```ts
const moveIssue = useMutation({
  mutationFn: (v: MoveVars) =>
    api.patch(`/issues/${v.issueId}/move`, { statusId: v.toStatusId, rank: v.rank, version: v.version }),

  onMutate: async (v) => {
    await qc.cancelQueries({ queryKey: ['board', v.boardId] });
    const prev = qc.getQueryData<BoardData>(['board', v.boardId]);
    qc.setQueryData<BoardData>(['board', v.boardId], (old) => applyMove(old, v)); // optimistic
    return { prev };
  },

  onError: (err, v, ctx) => {
    qc.setQueryData(['board', v.boardId], ctx?.prev);    // rollback
    if (isConflict(err)) {
      const c = (err as ApiError).conflict as ConflictPayload;
      qc.setQueryData(['board', v.boardId], (o) => applyServerState(o, c.current)); // dùng state server
      toast.warning('Issue đã bị người khác cập nhật. Đã đồng bộ phiên bản mới nhất.');
    } else {
      toast.error('Di chuyển thất bại, đã hoàn tác.');
    }
  },

  onSuccess: (res, v) => {
    // ghi version mới từ server vào cache (chuẩn hoá), KHÔNG invalidate (tránh nhấp nháy)
    qc.setQueryData(['board', v.boardId], (o) => applyServerState(o, res.data));
  },
});
```

### 9.3 Reconcile khi nhận socket event

```ts
// useRealtimeBoard.ts
useEffect(() => {
  const onMoved = (p: IssueMovedPayload) => {
    if (seen.has(p.eventId)) return; seen.add(p.eventId);
    qc.setQueryData<BoardData>(['board', boardId], (old) => {
      if (!old) return old;
      const card = findCard(old, p.issueId);
      if (!card) return old;                       // chưa có → để refetch lazy
      if (p.version <= card.version) return old;   // event cũ/đã áp dụng → no-op (idempotent)
      return applyMove(old, {
        issueId: p.issueId, toStatusId: p.to.statusId, rank: p.to.rank, version: p.version,
      });
    });
  };
  socket.on(ServerEvent.ISSUE_MOVED, onMoved);
  return () => { socket.off(ServerEvent.ISSUE_MOVED, onMoved); };
}, [boardId]);
```

### 9.4 Conflict — Optimistic Concurrency Control (server)

Server giữ `version` trên `Issue`. Mutation gửi kèm `version` client đang thấy.

```ts
// IssuesService.move (rút gọn) — Prisma
async move(issueId: string, dto: MoveDto, actor: ActorRef) {
  const updated = await this.prisma.issue.updateMany({
    where: { id: issueId, version: dto.version },     // OCC: chỉ update nếu version khớp
    data: { statusId: dto.statusId, rank: dto.rank, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    const current = await this.prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
    throw new ConflictException({
      code: 'VERSION_CONFLICT',
      conflict: { resource: 'issue', resourceId: issueId, yourVersion: dto.version,
                  currentVersion: current.version, current: toIssueDTO(current) },
    });   // → REST trả 409 với ConflictPayload
  }
  const issue = await this.prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
  this.events.emit('issue.moved', { issueId, boardId: dto.boardId,
    from: dto.from, to: { statusId: dto.statusId, rank: dto.rank },
    version: issue.version, prevVersion: dto.version, actor });
  return toIssueDTO(issue);
}
```

**Chiến lược giải quyết conflict:**

| Loại | Chiến lược |
|------|-----------|
| Move/reorder (status, rank) | **Last-write-wins** — server thắng, client áp `current` từ ConflictPayload |
| Field-level update (title, assignee, points) | **Field-level merge** — vì `changes` chỉ chứa field đổi, hai user sửa hai field khác nhau → cả hai áp dụng được; chỉ conflict thật khi cùng field. Cảnh báo toast khi cùng field. |
| Comment edit đồng thời | Last-write-wins + lưu lịch sử (edit history) → cho phép xem bản trước |
| Drag-drop hai người cùng card | OCC chặn người sau, client người sau nhận `issue:moved` của người trước qua socket trước cả khi mutation của họ về → optimistic rollback mượt |

### 9.5 Reconnect & gap recovery

Khi socket reconnect (mất mạng), client **có thể đã miss event**. Xử lý:

1. Khi `socket.on('connect')` (reconnect): client re-subscribe mọi room đang active (mục 10).
2. Đồng thời gọi `qc.invalidateQueries` cho các query đang mounted (board/issue/backlog) để refetch full state → đảm bảo không stale.
3. Không cần event replay phức tạp (không build event-sourcing). Refetch-on-reconnect là đủ và đơn giản.

---

## 10. Client Subscribe/Unsubscribe Theo Route

### 10.1 Hook trung tâm

```ts
// apps/web/src/hooks/useRoomSubscription.ts
export function useRoomSubscription(scope: Scope, id: string | undefined) {
  const socket = getSocket();
  useEffect(() => {
    if (!id) return;
    const sub = () => socket.emit(ClientEvent.SUBSCRIBE, { scope, id }, (ack: WsAck) => {
      if (!ack.ok) toast.error(`Không thể theo dõi ${scope}: ${ack.error}`);
    });
    if (socket.connected) sub(); else socket.once('connect', sub);
    socket.on('connect', sub);  // re-subscribe sau reconnect

    return () => {
      socket.emit(ClientEvent.UNSUBSCRIBE, { scope, id });
      socket.off('connect', sub);
    };
  }, [scope, id]);
}
```

### 10.2 Mapping route → subscription

| Route | Subscribe | Hook dùng |
|-------|-----------|-----------|
| `/projects/:projectId` (layout) | `project:{projectId}` | `useRoomSubscription('project', projectId)` |
| `/projects/:projectId/board/:boardId` | `board:{boardId}` (+project kế thừa từ layout) | `useRoomSubscription('board', boardId)` |
| `/projects/:projectId/backlog` | `backlog:{projectId}` | `useRoomSubscription('backlog', projectId)` |
| `/projects/:projectId/issues/:issueId` (modal hoặc page) | `issue:{issueId}` | `useRoomSubscription('issue', issueId)` + `useIssueViewer(issueId)` |
| `/projects/:projectId/sprints/:sprintId` | `sprint:{sprintId}` | `useRoomSubscription('sprint', sprintId)` |

- Subscription **kế thừa qua React tree**: project layout giữ project room sống suốt khi điều hướng trong project; board/issue room mount/unmount theo component. Unsubscribe tự động ở cleanup ⇒ rời route là leave room.
- **Issue modal**: vì issue thường mở dạng modal trên nền board, cả board room lẫn issue room cùng active — đúng ý đồ (card vẫn update sau lưng modal).
- Khi đóng tab/`beforeunload`: socket disconnect tự kích hoạt `handleDisconnect` server-side → cleanup presence.

### 10.3 Lifecycle socket toàn cục

```ts
// App.tsx
useEffect(() => {
  const socket = getSocket();
  if (useAuthStore.getState().accessToken) socket.connect();
  socket.on('connect:error', () => { /* thử refresh token rồi reconnect */ });
  return () => { socket.disconnect(); };
}, []);

// Sau khi refresh access token thành công:
function onTokenRefreshed() {
  const s = getSocket();
  s.disconnect();   // auth callback sẽ lấy token mới khi connect lại
  s.connect();
}
```

---

## 11. Scaling — Redis Adapter

### 11.1 Tại sao

Nhiều instance NestJS sau load balancer (sticky session hoặc không). Client A trên instance #1, client B trên instance #2 cùng ở `board:X`. Không có adapter, `server.to('board:X').emit()` ở #1 KHÔNG tới B. Redis adapter pub/sub mọi broadcast cross-instance.

### 11.2 Cấu hình adapter

```ts
// adapters/redis-io.adapter.ts
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  async connectToRedis(url: string): Promise<void> {
    const pub = createClient({ url });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    this.adapterConstructor = createAdapter(pub, sub);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
```

```ts
// main.ts
const adapter = new RedisIoAdapter(app);
await adapter.connectToRedis(config.get('REDIS_URL'));
app.useWebSocketAdapter(adapter);
```

### 11.3 Lưu ý scaling

- **Sticky session**: bật `transports: ['websocket']` thuần ⇒ không cần sticky vì không có HTTP long-polling upgrade. Nếu cho phép polling fallback, **phải** bật sticky ở LB (nginx `ip_hash` / `sticky` cookie) để handshake polling consistent.
- **Presence ở Redis** (mục 7) — KHÔNG dùng in-memory Map; nếu không, mỗi instance thấy presence khác nhau.
- **`@socket.io/redis-adapter`** chỉ làm pub/sub broadcast; để dùng `server.fetchSockets()`, `socketsJoin()` cross-instance cũng cần adapter này (đã có).
- **Graceful shutdown**: trên `SIGTERM`, gọi `server.close()` + flush presence connCount của instance đó để tránh count lệch. Lưu danh sách socketId của instance, decrement khi shutdown.
- **Sizing**: 1 instance Node xử lý ~10–20k socket. Redis 1 node đủ cho giai đoạn đầu; theo dõi pub/sub throughput. Có thể nâng lên Redis Cluster + `@socket.io/redis-streams-adapter` nếu cần message durability.
- **Docker Compose**: thêm service `redis:7-alpine`, biến `REDIS_URL=redis://redis:6379`. API depends_on redis.

```yaml
# docker-compose.yml (trích)
services:
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
  api:
    depends_on:
      redis: { condition: service_healthy }
      db:    { condition: service_healthy }
    environment:
      REDIS_URL: redis://redis:6379
```

---

## 12. Bảo Mật & Độ Bền

- **Rate limiting per-socket**: chặn flood typing/subscribe. Dùng token bucket trong guard (vd 30 msg/10s/socket) → vượt thì `WsException('RATE_LIMITED')`.
- **Validation**: mọi DTO client gửi qua `ValidationPipe` (`@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))`) — chặn payload rác.
- **Authorization mỗi message**, không chỉ ở subscribe: re-check `WsJwtGuard`. Broadcast chỉ tới room → user không ở room không nhận được (defense in depth: server tự quản join, client không tự join được).
- **Không leak data**: payload chỉ chứa field cần thiết; KHÔNG gửi full entity nhạy cảm. Field-level changes giảm payload.
- **CORS**: giới hạn `origin` theo `WEB_ORIGIN`.
- **Token revoke**: claim `tv` (tokenVersion); khi user đổi mật khẩu/logout-all, `tv` tăng → guard so sánh với `tv` hiện tại trong DB/cache, mismatch → disconnect.

---

## 13. Degrade Gracefully (khi realtime/Redis lỗi)

- Redis down lúc boot: log error, server vẫn chạy **single-instance mode** (adapter mặc định in-memory) — chấp nhận mất cross-instance broadcast; healthcheck báo degraded.
- Socket connect thất bại ở client: UI vẫn hoạt động bằng REST (TanStack Query). Hiển thị banner "Realtime ngoại tuyến — dữ liệu có thể chậm cập nhật". `refetchOnWindowFocus` + polling nhẹ làm fallback.
- Không có realtime KHÔNG được chặn thao tác — đây là enhancement, không phải dependency cứng. (Khác với AI subsystem cũng degrade gracefully — cùng triết lý.)

---

## 14. Điểm Giao Tiếp Với Subsystem Khác (Tóm Tắt)

| Subsystem | Hợp đồng / Tương tác |
|-----------|----------------------|
| **Auth (JWT)** | Dùng chung `JwtService`, `JWT_ACCESS_SECRET`, claim shape (`sub/orgId/roles/tv`). Refresh qua REST, không qua socket. |
| **RBAC** | `ProjectAccessService.canAccessProject(userId, projectId)` gọi trước mỗi subscribe. `resolveProjectId(scope, id)`. |
| **Issues / Board / Backlog** | Phát domain event sau commit (`issue.created/updated/moved/...`). Cung cấp `version` (OCC) trên model Issue. Endpoint `PATCH /issues/:id/move` nhận `version`, trả 409 + `ConflictPayload` khi lệch. |
| **Comments** | Phát `comment.created/updated/deleted` kèm `mentions[]`. Realtime route mention → `notification:new` cho `user:{id}`. |
| **Sprints** | Phát `sprint.started/completed/updated`, `backlog.changed`. |
| **Notifications** | NotificationsService tạo bản ghi DB rồi phát event → Realtime đẩy `notification:new` tới personal room. Realtime KHÔNG quyết định nội dung notification. |
| **Activity Log** | Phát `activity.new` → đẩy tới project/issue room cho activity feed realtime. |
| **Shared package** | `packages/shared/src/realtime.ts` chứa toàn bộ enum event + payload interface, import bởi cả FE và BE. |

---

## 15. Checklist Triển Khai (theo thứ tự)

1. `packages/shared/src/realtime.ts` — enums + payload types (làm trước, cả FE/BE phụ thuộc).
2. `RedisIoAdapter` + wiring `main.ts` + service `redis` trong compose.
3. `RealtimeModule` (`@Global`), `RealtimeGateway` connect/disconnect + `WsJwtGuard`.
4. `Room` util + `client:subscribe/unsubscribe` + RBAC check.
5. `PresenceService` + `TypingService` (Redis-backed) + events.
6. `RealtimeService` + `RealtimeBridge` (`@OnEvent`).
7. Thêm `version` field + OCC vào IssuesService; phát domain events sau commit.
8. FE: `socket.ts` (auth callback), `useRoomSubscription`, `useRealtimeBoard/Issue`, optimistic mutations + reconcile + dedupe.
9. Reconnect → re-subscribe + invalidate queries.
10. Rate limit + validation pipe + graceful shutdown.