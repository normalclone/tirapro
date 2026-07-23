# Backend Architecture (NestJS)

Đây là bản đặc tả thiết kế. Vì đây là nhiệm vụ thiết kế kiến trúc thuần túy (greenfield, thư mục trống), tôi sẽ tạo trực tiếp nội dung markdown đặc tả mà không cần đọc file hiện có.

# Đặc tả Thiết kế: Backend Architecture (NestJS) — Tirapro

> Subsystem: **Backend API**. Tài liệu này định nghĩa kiến trúc, conventions, và contracts của backend NestJS cho toàn bộ hệ thống Tirapro. Mọi subsystem khác (Frontend, Realtime, AI, DB/Prisma schema) giao tiếp với backend qua các điểm được nêu rõ ở mục [§14 Điểm giao tiếp](#14-điểm-giao-tiếp-với-subsystem-khác).

---

## 1. Tổng quan & Nguyên tắc kiến trúc

### 1.1. Triết lý
- **Modular Monolith** chạy trong một process NestJS (`apps/api`), tổ chức theo **feature module** + **domain boundary** rõ ràng để có thể tách microservice sau này.
- **Layered per-module**: `Controller → Service (use-case) → Repository (Prisma) → DB`. Controller mỏng, Service chứa business logic, Repository cô lập Prisma.
- **Dependency Injection** triệt để; không `new` service thủ công.
- **Contract-first response**: mọi response đi qua **response envelope** thống nhất (xem §11).
- **Fail loud, recover gracefully**: validation/exception tập trung; AI degrade gracefully khi thiếu API key (không 500).
- **Multi-tenant theo Workspace/Project**: mọi truy vấn nghiệp vụ phải scope theo `projectId`/`workspaceId` và kiểm RBAC.

### 1.2. Phiên bản & runtime
- Node.js LTS ≥ 20, NestJS 10, TypeScript 5.x (`strict: true`).
- Package manager: **pnpm workspaces** (monorepo). Backend là `apps/api`.
- Build: `nest build` (SWC compiler để build nhanh). Dev: `nest start --watch` qua `pnpm dev`.

---

## 2. Vị trí trong Monorepo

```
tirapro/
├─ apps/
│  ├─ api/                 # ← Subsystem NÀY (NestJS backend)
│  └─ web/                 # Frontend React (subsystem khác)
├─ packages/
│  ├─ db/                  # Prisma schema + generated client + migrations (DÙNG CHUNG)
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma
│  │  │  ├─ migrations/
│  │  │  └─ seed.ts
│  │  └─ src/index.ts      # export PrismaClient + types
│  ├─ contracts/           # DTO/Zod schemas & shared types (api ↔ web)
│  │  └─ src/              # ApiResponse<T>, enums, event payloads
│  └─ config/              # tsconfig base, eslint, prettier dùng chung
├─ docker-compose.yml      # postgres, redis, (minio optional)
├─ pnpm-workspace.yaml
└─ turbo.json (tùy chọn)
```

**Quyết định chốt:**
- Prisma schema đặt ở `packages/db` (không nằm trong `apps/api`) để frontend/seed/scripts dùng chung types. `apps/api` import `@tirapro/db`.
- Shared types & event payload contracts ở `packages/contracts` (`@tirapro/contracts`) — frontend import cùng định nghĩa, đảm bảo type-safe giữa BE↔FE↔Realtime.

---

## 3. Cấu trúc thư mục `apps/api/src`

```
apps/api/src/
├─ main.ts                         # bootstrap: pipes, filters, CORS, Swagger, helmet, prefix
├─ app.module.ts                   # root module — import tất cả feature + infra module
│
├─ common/                         # cross-cutting, KHÔNG chứa business logic
│  ├─ decorators/
│  │  ├─ current-user.decorator.ts # @CurrentUser()
│  │  ├─ permissions.decorator.ts  # @Permissions('issue:create')
│  │  ├─ public.decorator.ts       # @Public() bỏ qua JwtAuthGuard
│  │  └─ api-paginated.decorator.ts# swagger helper cho paginated response
│  ├─ dto/
│  │  ├─ pagination-query.dto.ts   # page,limit,cursor,sort,order
│  │  └─ id-param.dto.ts
│  ├─ filters/
│  │  ├─ all-exceptions.filter.ts  # catch-all → envelope lỗi
│  │  └─ prisma-exception.filter.ts# map Prisma error codes → HTTP
│  ├─ interceptors/
│  │  ├─ response.interceptor.ts   # bọc data → ApiResponse envelope
│  │  ├─ logging.interceptor.ts    # log req/res + duration + requestId
│  │  └─ timeout.interceptor.ts
│  ├─ guards/
│  │  ├─ jwt-auth.guard.ts
│  │  ├─ permissions.guard.ts      # đọc @Permissions + CASL ability
│  │  └─ ws-jwt.guard.ts           # auth cho socket
│  ├─ pipes/
│  │  └─ zod-validation.pipe.ts    # (tùy chọn, nếu dùng Zod cho 1 số route)
│  ├─ middleware/
│  │  └─ request-id.middleware.ts  # gắn x-request-id
│  ├─ utils/                        # pagination helpers, cursor encode/decode
│  └─ constants/                    # PERMISSIONS, QUEUE_NAMES, EVENTS
│
├─ config/
│  ├─ config.module.ts             # @nestjs/config global
│  ├─ configuration.ts             # load + nhóm config (app, db, jwt, redis, s3, ai)
│  └─ env.validation.ts            # validate env bằng class-validator/Joi
│
├─ infra/                          # adapters hạ tầng (không business)
│  ├─ prisma/
│  │  ├─ prisma.module.ts          # @Global
│  │  └─ prisma.service.ts         # extends PrismaClient, onModuleInit connect
│  ├─ redis/
│  │  └─ redis.module.ts           # ioredis provider (cache, bull, presence)
│  ├─ queue/
│  │  └─ queue.module.ts           # BullMQ registration
│  ├─ storage/
│  │  ├─ storage.module.ts
│  │  ├─ storage.service.ts        # interface IStorageService
│  │  ├─ local-storage.service.ts
│  │  └─ s3-storage.service.ts     # S3-compatible (MinIO)
│  └─ mailer/ (tùy chọn)
│
├─ modules/                        # FEATURE MODULES (business)
│  ├─ auth/
│  ├─ users/
│  ├─ workspaces/
│  ├─ projects/
│  ├─ members/                     # membership + role assignment
│  ├─ rbac/                        # roles, permissions, CASL ability factory
│  ├─ issues/
│  ├─ custom-fields/
│  ├─ workflows/                   # statuses + transitions
│  ├─ boards/                      # kanban + scrum board config
│  ├─ sprints/
│  ├─ backlog/
│  ├─ comments/
│  ├─ attachments/
│  ├─ search/                      # JQL-like parser + executor
│  ├─ reports/                     # burndown, velocity, CFD
│  ├─ dashboards/
│  ├─ notifications/
│  ├─ activity/                    # activity log / audit
│  ├─ ai/                          # Anthropic Claude integration
│  └─ realtime/                    # WebSocket gateway + presence
│
└─ health/                         # /health, /readiness (Terminus)
```

**Quy ước nội bộ mỗi feature module** (ví dụ `modules/issues`):
```
issues/
├─ issues.module.ts
├─ issues.controller.ts            # HTTP routes
├─ issues.service.ts               # use-cases / business
├─ issues.repository.ts            # mọi Prisma query của issue
├─ dto/
│  ├─ create-issue.dto.ts
│  ├─ update-issue.dto.ts
│  ├─ query-issues.dto.ts
│  └─ move-issue.dto.ts
├─ entities/                       # (tùy) view models / response shapes
│  └─ issue.entity.ts
├─ events/
│  └─ issue.events.ts              # IssueCreatedEvent, ...
└─ __tests__/ hoặc *.spec.ts
```

---

## 4. Danh sách Modules & Trách nhiệm

| Module | Trách nhiệm chính | Phụ thuộc chính | Phát event |
|---|---|---|---|
| **AuthModule** | Đăng ký/đăng nhập, JWT access+refresh, refresh token rotation, logout, đổi mật khẩu | Users, Prisma, Jwt, Config | `user.logged_in` |
| **UsersModule** | CRUD user, profile, avatar, presence flag | Prisma, Storage | — |
| **WorkspacesModule** | Workspace (tổ chức cấp cao chứa projects), settings | Members, RBAC | — |
| **ProjectsModule** | CRUD project, project key, lead, project settings, đa-team | Members, Workflows, RBAC | `project.*` |
| **MembersModule** | Gán user vào workspace/project + role; quản lý team | RBAC, Users | `member.added/removed` |
| **RbacModule** | Định nghĩa roles, permissions, CASL **AbilityFactory**, kiểm quyền | Prisma | — |
| **IssuesModule** | CRUD issue (Epic/Story/Task/Bug/Sub-task), hierarchy, link, transition status, assign, story points, custom field values | Workflows, CustomFields, Activity, Notifications, Search index, Realtime, AI | `issue.created/updated/moved/...` |
| **CustomFieldsModule** | Định nghĩa custom field theo project (text/number/select/date/user...), value storage | Prisma | — |
| **WorkflowsModule** | Workflow tùy biến: statuses + transitions + rules, validate transition hợp lệ | Projects | `workflow.updated` |
| **BoardsModule** | Cấu hình Kanban/Scrum board (columns ↔ statuses, swimlanes, WIP limit), thứ tự thẻ | Issues, Sprints, Workflows | `board.column_updated` |
| **SprintsModule** | Tạo/start/complete sprint, gán issue, capacity | Issues, Reports | `sprint.started/completed` |
| **BacklogModule** | Sắp xếp backlog (rank/LexoRank), kéo issue vào sprint | Issues, Sprints | — |
| **CommentsModule** | Comment + reply, **@mentions**, edit/delete (soft) | Notifications, Activity, AI (summary), Realtime | `comment.created`, `mention.created` |
| **AttachmentsModule** | Upload/download/xóa file đính kèm issue/comment (Multer + Storage) | StorageService | `attachment.added` |
| **SearchModule** | Parser **JQL-like** → Prisma where; semantic search (gọi AI) | Issues, AI | — |
| **ReportsModule** | Burndown, velocity, cumulative flow diagram (CFD) | Sprints, Issues, Activity | — |
| **DashboardsModule** | Dashboard tùy biến (gadgets/widgets), layout, export PDF/Excel | Reports, Issues | — |
| **NotificationsModule** | Tạo & truy vấn notification, đánh dấu đã đọc, đẩy realtime + email | Realtime, Queue, Mailer | — |
| **ActivityModule** | Activity log/audit trail mọi thay đổi (append-only) | Prisma | — |
| **AiModule** | Tích hợp Claude API: generate issue, summarize, suggest, sprint plan, semantic search; **degrade gracefully** khi thiếu key | Config, Issues (read) | — |
| **RealtimeModule** | Socket.io gateway, room theo project/issue/board, presence, broadcast events | Redis (adapter), Auth | (consume events) |
| **HealthModule** | `/health`, `/readiness` (DB, Redis) | Terminus, Prisma, Redis | — |

> **Event bus nội bộ**: dùng `@nestjs/event-emitter` (`EventEmitter2`) cho các domain event đồng bộ trong process. RealtimeModule và NotificationsModule **subscribe** event để broadcast/đẩy noti, giúp IssuesModule không phụ thuộc trực tiếp Realtime (decoupling). Event có side-effect nặng (email, AI) đẩy sang **BullMQ**.

---

## 5. Pattern: Module / Controller / Service / Repository

### 5.1. Repository pattern (cô lập Prisma)
Repository **chỉ** chứa truy vấn Prisma cho một aggregate. Service không gọi `prisma.*` trực tiếp (trừ giao dịch cross-aggregate dùng `prisma.$transaction`).

```ts
// modules/issues/issues.repository.ts
@Injectable()
export class IssuesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.issue.findUnique({
      where: { id },
      include: { assignee: true, status: true, customValues: true },
    });
  }

  // Pagination chuẩn (cursor) — xem §10
  async findManyByProject(projectId: string, q: QueryIssuesDto) {
    const where = this.buildWhere(projectId, q);
    const items = await this.prisma.issue.findMany({
      where,
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
      orderBy: { [q.sort]: q.order },
    });
    return items;
  }

  // Cho phép truyền tx để dùng trong $transaction
  create(data: Prisma.IssueCreateInput, tx: Prisma.TransactionClient = this.prisma) {
    return tx.issue.create({ data });
  }
}
```

### 5.2. Service (use-case + business rules)
```ts
@Injectable()
export class IssuesService {
  constructor(
    private readonly repo: IssuesRepository,
    private readonly workflows: WorkflowsService,
    private readonly events: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

  async transition(issueId: string, toStatusId: string, actor: AuthUser) {
    const issue = await this.repo.findById(issueId);
    if (!issue) throw new NotFoundException('Issue not found');

    // Business rule: transition phải hợp lệ trong workflow
    await this.workflows.assertTransitionAllowed(issue.statusId, toStatusId, issue.projectId);

    const updated = await this.repo.update(issueId, { statusId: toStatusId });
    this.events.emit('issue.transitioned', new IssueTransitionedEvent(updated, issue.statusId, actor.id));
    return updated;
  }
}
```

### 5.3. Controller (mỏng, khai báo contract)
```ts
@ApiTags('issues')
@Controller('projects/:projectId/issues')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IssuesController {
  constructor(private readonly service: IssuesService) {}

  @Get()
  @Permissions('issue:read')
  @ApiPaginatedResponse(IssueEntity)
  list(@Param('projectId') projectId: string, @Query() q: QueryIssuesDto) {
    return this.service.list(projectId, q);
  }

  @Post()
  @Permissions('issue:create')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(projectId, dto, user);
  }
}
```

**Nguyên tắc:** Controller không chứa `if` business; chỉ map route → service và khai báo guard/permission/swagger.

---

## 6. Prisma Integration

### 6.1. PrismaService
```ts
// infra/prisma/prisma.service.ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      datasources: { db: { url: config.get('db.url') } },
      log: config.get('app.env') === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
    });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }

  // Helper soft-delete / transaction wrapper nếu cần
}
```
```ts
// infra/prisma/prisma.module.ts
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

### 6.2. Quy ước Prisma
- **Migration & schema** ở `packages/db`. Lệnh: `pnpm --filter @tirapro/db prisma migrate dev`, `prisma generate` (chạy postinstall).
- **Transaction**: nghiệp vụ cross-aggregate (vd: complete sprint + move incomplete issues) bọc trong `prisma.$transaction(async (tx) => {...})`; repository nhận `tx` optional.
- **Soft delete**: dùng cột `deletedAt DateTime?`; repository tự thêm `where: { deletedAt: null }`. (Cân nhắc Prisma extension/middleware để áp dụng nhất quán.)
- **Naming**: model PascalCase singular (`Issue`, `Sprint`); enum PascalCase; field camelCase. FK index đầy đủ cho cột lọc nóng (`projectId`, `sprintId`, `statusId`, `assigneeId`).
- **Optimistic locking** cho issue (tránh ghi đè realtime): cột `version Int @default(1)`, update kèm `where: { id, version }`.
- **Map Prisma error** sang HTTP qua `PrismaExceptionFilter` (P2002 → 409 Conflict, P2025 → 404, P2003 → 409/400).

> Schema chi tiết do subsystem **DB/Prisma** sở hữu; backend chỉ định contract: cần các model `User, Workspace, Project, Member, Role, Permission, Issue, IssueType, Status, Transition, Workflow, CustomField, CustomFieldValue, Board, BoardColumn, Sprint, Comment, Mention, Attachment, Notification, ActivityLog, RefreshToken`. Backend **đề xuất** ràng buộc ở §6.2 (version, deletedAt, index).

---

## 7. Configuration (ConfigModule + Env)

### 7.1. Nhóm config
```ts
// config/configuration.ts
export default () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '4000', 10),
    globalPrefix: 'api/v1',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  },
  db: { url: process.env.DATABASE_URL },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  redis: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local', // 'local' | 's3'
    localDir: process.env.STORAGE_LOCAL_DIR ?? './uploads',
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET,
      accessKey: process.env.S3_ACCESS_KEY,
      secretKey: process.env.S3_SECRET_KEY,
      forcePathStyle: true, // cho MinIO
    },
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '25', 10),
  },
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? null, // null => degrade gracefully
    model: process.env.AI_MODEL ?? 'claude-opus-4-8',
    fastModel: process.env.AI_FAST_MODEL ?? 'claude-sonnet-4-6',
    enabled: !!process.env.ANTHROPIC_API_KEY,
  },
});
```

### 7.2. Validate env (fail fast khi thiếu biến bắt buộc)
```ts
// config/env.validation.ts
class EnvVars {
  @IsIn(['development', 'production', 'test']) NODE_ENV: string;
  @IsString() DATABASE_URL: string;
  @IsString() JWT_ACCESS_SECRET: string;
  @IsString() JWT_REFRESH_SECRET: string;
  @IsOptional() @IsString() ANTHROPIC_API_KEY?: string; // optional → AI degrade
}
export function validateEnv(cfg: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, cfg, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length) throw new Error(`Config validation error: ${errors}`);
  return validated;
}
```
```ts
// config/config.module.ts
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
})
export class ConfigModule {}
```
> File `.env.example` được commit; `.env` ignore. Thiếu `ANTHROPIC_API_KEY` ⇒ app vẫn boot, `AiModule` trả fallback (xem §13).

---

## 8. Validation (class-validator + ValidationPipe)

### 8.1. Global pipe (`main.ts`)
```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,            // loại field thừa
  forbidNonWhitelisted: true, // 400 nếu gửi field lạ
  transform: true,            // auto-transform sang DTO instance
  transformOptions: { enableImplicitConversion: true },
}));
```

### 8.2. DTO mẫu
```ts
// modules/issues/dto/create-issue.dto.ts
export class CreateIssueDto {
  @IsString() @MinLength(1) @MaxLength(255)
  title: string;

  @IsOptional() @IsString() @MaxLength(20000)
  description?: string;

  @IsEnum(IssueTypeEnum)
  type: IssueTypeEnum; // EPIC | STORY | TASK | BUG | SUBTASK

  @IsOptional() @IsUUID()
  assigneeId?: string;

  @IsOptional() @IsUUID()
  parentId?: string; // cho sub-task / story dưới epic

  @IsOptional() @IsInt() @Min(0) @Max(100)
  storyPoints?: number;

  @IsOptional() @ValidateNested({ each: true }) @Type(() => CustomFieldValueDto)
  customFields?: CustomFieldValueDto[];
}
```
**Quy ước:** DTO đặt trong `dto/`, hậu tố `.dto.ts`. Dùng `@Type()` cho nested. Enum dùng chung từ `@tirapro/contracts`. Swagger lấy schema từ DTO (`@ApiProperty` qua plugin `@nestjs/swagger` CLI để giảm boilerplate).

---

## 9. Error Handling (Exception Filters)

### 9.1. Hệ thống lỗi
- Chuẩn lỗi nghiệp vụ: throw HttpException con của Nest (`NotFoundException`, `ForbiddenException`, `ConflictException`...).
- Lỗi domain tùy biến: lớp `DomainException extends HttpException` với `code` ổn định (machine-readable).
- **AllExceptionsFilter** (catch-all) chuẩn hóa mọi lỗi về envelope; **PrismaExceptionFilter** map lỗi Prisma trước.

### 9.2. Envelope lỗi
```jsonc
{
  "success": false,
  "error": {
    "code": "ISSUE_NOT_FOUND",     // machine-readable
    "message": "Issue not found",  // human-readable
    "details": [                   // (tùy) lỗi validation field-level
      { "field": "title", "message": "title should not be empty" }
    ]
  },
  "meta": { "requestId": "req_abc123", "timestamp": "2026-06-24T10:00:00Z" }
}
```

### 9.3. Filter
```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private logger = new Logger('Exception');
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as any;
      message = r?.message ?? exception.message;
      code = r?.code ?? this.statusToCode(status);
      if (Array.isArray(r?.message)) { details = r.message; message = 'Validation failed'; code = 'VALIDATION_ERROR'; }
    }

    if (status >= 500) this.logger.error(`${req.method} ${req.url}`, (exception as Error)?.stack);

    res.status(status).json({
      success: false,
      error: { code, message, ...(details ? { details } : {}) },
      meta: { requestId: (req as any).requestId, timestamp: new Date().toISOString() },
    });
  }
}
```
> Filter đăng ký global trong `main.ts` (thứ tự: PrismaExceptionFilter trước AllExceptionsFilter). WebSocket dùng filter riêng (`WsExceptionFilter`) emit `error` event.

---

## 10. Logging / Interceptors

| Interceptor | Trách nhiệm |
|---|---|
| **RequestIdMiddleware** | Đọc/sinh `x-request-id`, gắn `req.requestId`, set vào AsyncLocalStorage (correlation) |
| **LoggingInterceptor** | Log `method url status durationMs userId requestId`; redact body nhạy cảm |
| **ResponseInterceptor** | Bọc data → ApiResponse envelope (§11), bỏ qua nếu controller trả raw stream/file |
| **TimeoutInterceptor** | Hủy request quá ngưỡng (vd 30s; AI route ngưỡng cao hơn) |

- **Logger**: dùng **nestjs-pino** (Pino) cho structured JSON log + auto request logging, gắn `requestId`, `userId`. Production: JSON; dev: pretty.
- Log AI calls (model, tokens, latency) ở mức info để theo dõi chi phí.

```ts
// response.interceptor.ts (rút gọn)
intercept(ctx, next) {
  return next.handle().pipe(map((data) => {
    if (data?.__raw) return data.payload;      // bỏ qua bọc
    if (isPaginated(data)) return { success: true, ...data }; // giữ pageInfo
    return { success: true, data, meta: { timestamp: new Date().toISOString() } };
  }));
}
```

---

## 11. Response Envelope & Conventions

### 11.1. Envelope thành công
```jsonc
// single
{ "success": true, "data": { /* resource */ }, "meta": { "timestamp": "..." } }

// paginated (cursor)
{
  "success": true,
  "data": [ /* items */ ],
  "pageInfo": { "nextCursor": "eyJpZCI6...", "hasNextPage": true, "limit": 20 },
  "meta": { "timestamp": "..." }
}

// paginated (offset)
{
  "success": true,
  "data": [ /* items */ ],
  "pageInfo": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 }
}
```
> Type `ApiResponse<T>`, `Paginated<T>`, `PageInfo` định nghĩa ở `@tirapro/contracts` — frontend import trực tiếp (type-safe end-to-end).

### 11.2. Conventions
- **REST**: số nhiều, lồng theo tài nguyên cha: `GET /api/v1/projects/:projectId/issues`, `POST /.../sprints/:sprintId/complete` (action endpoint dùng verb sau danh từ).
- **HTTP status**: 200 GET/PATCH, 201 POST, 204 DELETE no-content, 400 validation, 401 auth, 403 RBAC, 404, 409 conflict/version.
- **Versioning**: URI prefix `api/v1` (NestJS `enableVersioning` URI).
- **Naming code**: `SCREAMING_SNAKE_CASE` cho error code; event `dot.notation`; permission `resource:action`.
- **Date**: ISO-8601 UTC. **ID**: UUID v4 (hoặc CUID) string.
- **Idempotency**: action mutating quan trọng (start/complete sprint) chấp nhận header `Idempotency-Key` (lưu Redis) — optional cho v1.

---

## 12. Auth (JWT + Refresh Token Rotation)

### 12.1. Token model
- **Access token**: JWT ngắn hạn (15m), payload `{ sub, email, jti }`. Permission **không** nhét vào token (tránh stale) — resolve runtime từ DB/cache.
- **Refresh token**: JWT 7d, **rotation** + lưu hash trong DB (`RefreshToken { id, userId, tokenHash, family, expiresAt, revokedAt }`). Phát hiện reuse → revoke cả family (chống token theft).

### 12.2. Luồng
```
POST /auth/register → tạo user (bcrypt/argon2 hash) → trả access+refresh
POST /auth/login    → verify → cấp access(15m)+refresh(7d, lưu hash)
POST /auth/refresh  → verify refresh + so hash + chưa revoke
                      → cấp cặp mới (rotate), revoke token cũ, cùng family
                      → nếu token cũ đã revoke (reuse) ⇒ revoke family + 401
POST /auth/logout   → revoke refresh hiện tại
GET  /auth/me       → thông tin user + memberships + permissions
```
Refresh token trả qua **httpOnly Secure cookie** (`SameSite=Strict`) hoặc body (frontend chọn); access token frontend giữ in-memory.

### 12.3. Strategies & Guards
```ts
// JwtStrategy (access)
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('jwt.accessSecret'),
    });
  }
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.users.findActiveById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email }; // gắn vào req.user
  }
}
```
- **JwtAuthGuard** (global, dùng `@Public()` để bỏ qua route công khai như login/health).
- `@CurrentUser()` decorator trả `AuthUser`.
- Password hash: **argon2id** (ưu tiên) hoặc bcrypt(12).

---

## 13. RBAC (CASL + Permissions decorator)

### 13.1. Mô hình
- **Permission** dạng `resource:action` (vd `issue:create`, `issue:transition`, `sprint:manage`, `project:admin`).
- **Role** (System: `OWNER, ADMIN, MEMBER, VIEWER` + custom per-workspace) ánh xạ tập permissions.
- **Scope**: quyền gắn theo **project** (qua `Member { userId, projectId, roleId }`) hoặc workspace. Guard resolve scope từ `:projectId` param.

### 13.2. Quyết định: **CASL** cho quyền có điều kiện + custom guard cho check nhanh
- Dùng **CASL `AbilityFactory`** để diễn đạt quyền theo điều kiện (vd: MEMBER chỉ sửa issue mình tạo/được assign; ADMIN sửa mọi issue trong project).
- `@Permissions('issue:create')` cho check coarse-grained (route-level).
- Service-level dùng `ability.can('update', subject('Issue', issue))` cho fine-grained (ownership).

```ts
// rbac/ability.factory.ts
type Subjects = 'Issue' | 'Sprint' | 'Project' | 'Comment' | 'all';
export type AppAbility = MongoAbility<[string, Subjects | object]>;

@Injectable()
export class AbilityFactory {
  constructor(private rbac: RbacService) {}
  async createForUser(user: AuthUser, projectId?: string): Promise<AppAbility> {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    const perms = await this.rbac.getPermissions(user.id, projectId); // cache Redis 60s

    for (const p of perms) {
      const [action, resource] = p.split(':'); // 'issue:update'
      can(action, capitalize(resource));
    }
    // điều kiện ownership ví dụ
    if (perms.includes('issue:update:own')) {
      can('update', 'Issue', { assigneeId: user.id });
    }
    return build({ detectSubjectType: (i: any) => i.__type });
  }
}
```
```ts
// permissions.guard.ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector, private abilityFactory: AbilityFactory) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest();
    const projectId = req.params.projectId;
    const ability = await this.abilityFactory.createForUser(req.user, projectId);
    req.ability = ability; // service dùng lại cho fine-grained

    return required.every((perm) => {
      const [action, resource] = perm.split(':');
      return ability.can(action, capitalize(resource));
    });
  }
}
```
- **Permission cache**: cache permission của (user, project) trong Redis TTL ngắn (60s); invalidate khi `member.role_changed`.
- Danh sách permission canonical ở `common/constants/permissions.ts` và export `@tirapro/contracts` (frontend ẩn UI theo quyền).

---

## 14. Pagination / Filtering / Sorting chuẩn

### 14.1. Query DTO chung
```ts
// common/dto/pagination-query.dto.ts
export class PaginationQueryDto {
  @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  page?: number = 1;                 // offset mode

  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number)
  limit?: number = 20;

  @IsOptional() @IsString()
  cursor?: string;                   // cursor mode (ưu tiên cho list dài: issues, activity)

  @IsOptional() @IsString()
  sort?: string = 'createdAt';

  @IsOptional() @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}
```
- **Cursor pagination** (mặc định cho issues/activity/comments — list lớn, realtime): cursor = base64(`{id, sortValue}`), ổn định khi data thay đổi.
- **Offset pagination** cho list nhỏ/cần tổng số (members, projects).
- **Filtering**: query-specific DTO mở rộng (`QueryIssuesDto extends PaginationQueryDto` thêm `status[], assigneeId, type[], sprintId, q, labels[]`). Whitelist field sort hợp lệ (chống injection). Map sang Prisma `where` trong repository.
- JQL phức tạp đi qua **SearchModule** (§ riêng), không nhồi vào query param thường.

---

## 15. File Upload (Multer + Local/S3)

### 15.1. Abstraction
```ts
export interface IStorageService {
  put(key: string, buf: Buffer, mime: string): Promise<{ key: string; url: string }>;
  getSignedUrl(key: string, ttlSec?: number): Promise<string>;
  delete(key: string): Promise<void>;
  createReadStream(key: string): Promise<Readable>;
}
```
- `STORAGE_DRIVER=local` → ghi `./uploads`, serve qua endpoint stream có auth. `=s3` → S3-compatible (MinIO trong docker-compose), trả **pre-signed URL** cho download trực tiếp.
- Module provider chọn implementation theo config (factory provider).

### 15.2. Controller upload
```ts
@Post('issues/:issueId/attachments')
@Permissions('attachment:create')
@UseInterceptors(FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // đồng bộ config
  fileFilter: allowedMimeFilter,           // whitelist mime, chặn exe
}))
upload(
  @Param('issueId') issueId: string,
  @UploadedFile() file: Express.Multer.File,
  @CurrentUser() user: AuthUser,
) {
  return this.attachments.upload(issueId, file, user);
}
```
- Sinh key `attachments/{projectId}/{issueId}/{uuid}-{filename}`. Validate magic bytes (không tin extension). Quét kích thước/mime. Lưu metadata DB (`Attachment`).
- Download: route `GET .../attachments/:id` → check quyền → local stream / redirect signed URL.

---

## 16. Background Jobs (BullMQ + Redis)

### 16.1. Vì sao BullMQ
Cần xử lý async/nặng tách khỏi request: gửi email notification, gọi AI (summarize/embedding) batch, build report nặng, export PDF/Excel, re-index search, dọn refresh token hết hạn.

### 16.2. Queues
```ts
// common/constants/queues.ts
export const QUEUE = {
  NOTIFICATIONS: 'notifications',
  AI: 'ai',
  REPORTS: 'reports',
  SEARCH_INDEX: 'search-index',
  EXPORT: 'export',
  MAINTENANCE: 'maintenance', // cron: cleanup tokens
} as const;
```
- `@nestjs/bullmq` với `BullModule.forRootAsync` (Redis URL từ config). Mỗi domain có `*.processor.ts` (`@Processor`) + producer trong service.
- **Retry/backoff**: `attempts: 3, backoff: { type: 'exponential', delay: 2000 }`. Dead-letter qua `removeOnFail: false` + queue events log.
- **Repeatable job** (cron) cho maintenance: dùng BullMQ repeat options.
- **Idempotent processor**: job có `jobId` (vd `notif:{eventId}`) chống xử lý trùng.
- AI degrade: nếu `ai.enabled === false`, AI processor short-circuit, đánh dấu kết quả "AI unavailable".

> Worker chạy **cùng process** với API ở dev (đơn giản cho `pnpm dev`); production có thể tách `apps/api` chạy `--worker` flag (cùng codebase, bật `bull` processors riêng) — kiến trúc cho phép tách.

---

## 17. WebSocket Gateway (Socket.io) — tổ chức

> Realtime là subsystem riêng, nhưng phần **gateway tổ chức trong NestJS** thuộc backend. Đặc tả ở đây tập trung cấu trúc & contract; chi tiết presence/optimistic do subsystem Realtime mở rộng.

### 17.1. Cấu trúc
```
modules/realtime/
├─ realtime.module.ts
├─ realtime.gateway.ts        # @WebSocketGateway namespace '/ws'
├─ presence.service.ts        # track online users per project/issue (Redis)
├─ rooms.ts                   # helper: room('project', id), room('issue', id)
├─ ws-events.constants.ts     # tên event chuẩn
└─ realtime.listener.ts       # @OnEvent('issue.*') → broadcast vào room
```

### 17.2. Gateway
```ts
@WebSocketGateway({ namespace: '/ws', cors: { origin: corsOrigins } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  constructor(private presence: PresenceService) {}

  async handleConnection(client: Socket) {
    // WsJwtGuard đã verify token (query/auth header) trong middleware
    const user = client.data.user as AuthUser;
    if (!user) return client.disconnect();
  }

  @SubscribeMessage('join:project')
  joinProject(@ConnectedSocket() c: Socket, @MessageBody() { projectId }: JoinDto) {
    c.join(room('project', projectId));
    this.presence.add(projectId, c.data.user.id);
    this.server.to(room('project', projectId)).emit('presence:update', this.presence.list(projectId));
  }
}
```
- **Auth**: `WsJwtGuard` / middleware verify JWT từ `handshake.auth.token`; gắn `socket.data.user`.
- **Rooms**: `project:{id}`, `issue:{id}`, `board:{id}`, `user:{id}` (noti cá nhân). Client join khi mở view tương ứng.
- **Scale-out**: `@socket.io/redis-adapter` (Redis pub/sub) cho multi-instance.
- **Event bridge**: `RealtimeListener` `@OnEvent('issue.updated')` → `server.to(room('issue', id)).emit('issue:updated', payload)`. Decouple gateway khỏi business module.
- **Contract events** (`@tirapro/contracts`): `issue:created|updated|moved|deleted`, `comment:created`, `board:column_changed`, `presence:update`, `notification:new`, `sprint:started|completed`.

### 17.3. Optimistic UI (giao tiếp FE)
- Mutation REST thành công → backend emit event kèm `version` + `actorId`. FE bỏ qua echo của chính mình (so `actorId`/`requestId`) để tránh giật.

---

## 18. AI Module (Claude) — degrade gracefully

> Tích hợp chi tiết do subsystem AI sở hữu; backend cung cấp **AiModule** làm cổng.

- **AnthropicService** wrap SDK `@anthropic-ai/sdk`, model `claude-opus-4-8` (chất lượng cao) / `claude-sonnet-4-6` (nhanh/rẻ cho summarize, suggest).
- **Degrade gracefully**: nếu `ai.enabled === false` (thiếu key) → mọi method trả `{ available: false, fallback: <heuristic|null> }` thay vì throw; controller trả 200 với cờ `aiAvailable: false`. UI ẩn/hiện theo cờ này.
- Use-cases: `generateIssueFromText`, `summarizeIssue`, `summarizeThread`, `suggestAssignee/Priority/StoryPoints`, `planSprint`, `semanticSearch` (embedding → pgvector nếu bật, fallback keyword).
- Tác vụ chậm/nhiều token → đẩy qua **AI queue** (§16), trả `jobId`, FE poll/nhận realtime.
- Streaming (summarize) có thể proxy qua SSE endpoint `GET /ai/stream/...`.

---

## 19. Bootstrap (`main.ts`) — thứ tự khởi tạo

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));                 // nestjs-pino
  app.setGlobalPrefix('api/v1');
  app.enableVersioning({ type: VersioningType.URI });
  app.use(helmet());
  app.enableCors({ origin: config.app.corsOrigins, credentials: true });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor(), new LoggingInterceptor());
  app.useGlobalFilters(new PrismaExceptionFilter(), new AllExceptionsFilter());
  app.useGlobalGuards(app.get(JwtAuthGuard));      // + @Public bỏ qua
  app.useWebSocketAdapter(new RedisIoAdapter(app)); // socket.io + redis adapter

  if (config.app.env !== 'production') setupSwagger(app); // /api/docs

  await app.listen(config.app.port);
}
```

---

## 20. Testing & Quality (định hướng)
- **Unit**: service + repository (mock Prisma qua `jest-mock-extended`).
- **e2e**: `@nestjs/testing` + Supertest, DB test container (Testcontainers) hoặc schema riêng.
- **Lint/format**: ESLint + Prettier dùng chung `packages/config`.
- **Coverage** target ≥ 70% core domain (issues, auth, rbac, workflows).

---

## 21. Bảng Convention tóm tắt

| Hạng mục | Convention |
|---|---|
| File module | `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.dto.ts`, `*.guard.ts`, `*.events.ts` |
| Route | `api/v1/<plural>` lồng theo cha; action = verb sau danh từ |
| Permission | `resource:action`, biến thể `:own` cho ownership |
| Event nội bộ | `domain.action` (vd `issue.transitioned`) |
| WS event | `domain:action` (vd `issue:updated`) |
| Error code | `SCREAMING_SNAKE_CASE` |
| Queue name | `kebab-case` |
| Env | `SCREAMING_SNAKE_CASE`, validate fail-fast (trừ optional AI) |
| ID | UUID/CUID string; Date ISO-8601 UTC |
| Response | Envelope `{ success, data|error, pageInfo?, meta }` |

---

## 22. Điểm giao tiếp với Subsystem khác

| Đối tác | Giao tiếp | Hợp đồng |
|---|---|---|
| **Frontend (web)** | REST `api/v1/*` + WS `/ws` | Import `@tirapro/contracts` (ApiResponse, DTO types, enums, event payloads, permission list). Auth: Bearer access + refresh cookie. |
| **DB / Prisma** | `@tirapro/db` PrismaClient | Backend đề xuất model contract & ràng buộc (`version`, `deletedAt`, indexes) ở §6; schema do DB subsystem chốt. Migrations chạy từ `packages/db`. |
| **Realtime** | `EventEmitter2` (in-process) → `RealtimeListener` → Socket.io | Domain event names (§4) là contract; gateway broadcast theo room. Redis adapter để scale. |
| **AI** | `AiModule` (cổng) + `AI` BullMQ queue | Method trả `{ available, data|fallback }`; cờ `aiAvailable` trong response. Model id từ config. |
| **Infra (Docker)** | Postgres, Redis, (MinIO) | `DATABASE_URL`, `REDIS_URL`, `S3_*` từ env; `docker compose up` cung cấp. Health check `/health` cho readiness. |
| **Notifications/Email** | BullMQ `NOTIFICATIONS` queue | Event domain → tạo notification record + push WS `notification:new` + email (mailer adapter, optional). |

---

## 23. Thứ tự triển khai đề xuất (cho team code)
1. `packages/db` (schema tối thiểu) + `packages/contracts` + `infra/prisma` + `config` + `main.ts` bootstrap + `common/*`.
2. `AuthModule` + `UsersModule` + `RbacModule` (nền tảng bảo mật).
3. `WorkspacesModule` + `ProjectsModule` + `MembersModule` + `WorkflowsModule` + `CustomFieldsModule`.
4. `IssuesModule` (core) + `ActivityModule` + `EventEmitter`.
5. `BoardsModule` + `SprintsModule` + `BacklogModule` + `CommentsModule` + `AttachmentsModule`.
6. `RealtimeModule` + `NotificationsModule` + `Queue/BullMQ`.
7. `SearchModule` + `ReportsModule` + `DashboardsModule`.
8. `AiModule` (sau cùng, degrade gracefully) + export PDF/Excel + PWA-supporting endpoints.