# API Contract (REST + WS)

Đây là bản đặc tả thiết kế subsystem API Contract. Do nhiệm vụ là viết một tài liệu thiết kế (không phải đọc/sửa code trong thư mục trống), tôi sẽ tạo trực tiếp nội dung markdown.

# Đặc Tả Thiết Kế: API Contract (REST + WebSocket) — Tirapro

> **Subsystem owner:** API Contract Architect
> **Phạm vi tài liệu:** Hợp đồng API toàn hệ thống — REST endpoints, WebSocket events, JQL-like search grammar, pagination & error format chuẩn hóa. Tài liệu này là **single source of truth** cho mọi subsystem khác (Frontend, Realtime, AI, Auth, Persistence) khi gọi/triển khai API.
> **Tech stack ràng buộc:** NestJS 10 + Prisma + PostgreSQL, Socket.io, JWT (access + refresh), Anthropic Claude API (`claude-opus-4-8` / `claude-sonnet-4-6`).

---

## 0. Quy ước chung (Conventions)

### 0.1. Base URL & versioning

| Mục | Giá trị |
|---|---|
| REST base path | `/api/v1` |
| WebSocket base | `/ws` (Socket.io path: `/socket.io`) |
| Content-Type | `application/json; charset=utf-8` (trừ upload: `multipart/form-data`) |
| Versioning | URI versioning (`v1`). NestJS `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })` |
| Timezone | Toàn bộ timestamp ở định dạng **ISO 8601 UTC** (`2026-06-24T08:30:00.000Z`) |
| ID format | `cuid` (Prisma `@default(cuid())`) — string, không phải UUID. Ví dụ: `clz3k9f8x0001a8b2c3d4e5f6` |

### 0.2. Headers chuẩn

**Request headers:**
```
Authorization: Bearer <access_token>      # JWT access token (bắt buộc cho protected routes)
X-Request-Id: <uuid>                       # optional client-generated trace id; nếu thiếu, server tự sinh
X-Org-Id: <orgId>                          # optional tenant hint; server vẫn ưu tiên scope theo token
Idempotency-Key: <uuid>                    # optional, cho POST tạo resource cần idempotent
```

**Response headers:**
```
X-Request-Id: <uuid>                       # echo lại để trace
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1719220200              # epoch seconds
```

### 0.3. Naming & method semantics

- Resource paths dùng **plural nouns**, kebab-case nếu nhiều từ (`/story-points` không dùng — ưu tiên 1 từ).
- `GET` (list/detail, idempotent, cacheable) · `POST` (create / action không idempotent) · `PATCH` (partial update) · `PUT` (full replace, hiếm dùng) · `DELETE` (xóa).
- Action không CRUD-thuần dùng sub-resource POST: `POST /issues/{id}/transitions`, `POST /issues/{id}/move`.

### 0.4. Quyền & scope (giao tiếp với subsystem RBAC)

- Mọi route (trừ `/auth/*` public) đi qua `JwtAuthGuard` → `OrgScopeGuard` → `PermissionsGuard`.
- Permission được khai báo qua decorator: `@RequirePermission('issue:update')`. Danh sách permission key do subsystem **RBAC** định nghĩa; API Contract chỉ tham chiếu key string. Bảng permission key xem §11.
- Scope resolution: `orgId` lấy từ JWT claim; `projectId` resolve từ path → kiểm tra membership.

---

## 1. Pagination chuẩn

Hỗ trợ **2 chế độ**. Mặc định endpoint list dùng **cursor-based** (ổn định cho realtime feed), một số endpoint analytics dùng **offset-based**.

### 1.1. Cursor-based (mặc định cho list resource lớn: issues, comments, notifications, activity)

**Query params:**
```
?limit=25            # default 25, max 100
&cursor=<opaque>     # base64 của { id, sortValue }; omit ở trang đầu
&sort=createdAt:desc # field:direction; whitelist theo resource
```

**Response envelope:**
```jsonc
{
  "data": [ /* ...items */ ],
  "pageInfo": {
    "hasNextPage": true,
    "endCursor": "eyJpZCI6ImNsejNrIiwic29ydFZhbHVlIjoiMjAyNi0wNi0yNCJ9",
    "limit": 25
  }
}
```

**Map sang Prisma:**
```ts
const items = await prisma.issue.findMany({
  take: limit + 1,                       // lấy dư 1 để biết hasNextPage
  ...(cursor && { cursor: { id: decoded.id }, skip: 1 }),
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // tie-breaker bằng id để cursor ổn định
  where,
});
const hasNextPage = items.length > limit;
const data = hasNextPage ? items.slice(0, limit) : items;
```

### 1.2. Offset-based (cho reports / dashboards / bảng có total count)

**Query params:** `?page=1&pageSize=20&sort=createdAt:desc`

**Response envelope:**
```jsonc
{
  "data": [ /* ...items */ ],
  "pageInfo": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 342,
    "totalPages": 18
  }
}
```

---

## 2. Error format chuẩn (RFC 7807-inspired)

Mọi lỗi đi qua một `AllExceptionsFilter` global trả về JSON đồng nhất:

```jsonc
{
  "error": {
    "code": "ISSUE_NOT_FOUND",          // mã ổn định, SCREAMING_SNAKE_CASE
    "message": "Issue clz3k... không tồn tại hoặc bạn không có quyền truy cập.",
    "statusCode": 404,
    "requestId": "9f1c2e7a-...",
    "timestamp": "2026-06-24T08:30:00.000Z",
    "path": "/api/v1/issues/clz3k",
    "details": [                          // optional — dùng cho validation errors
      { "field": "title", "code": "REQUIRED", "message": "title không được rỗng" },
      { "field": "storyPoints", "code": "MAX", "message": "tối đa 100" }
    ]
  }
}
```

### 2.1. Bảng error code → HTTP status

| HTTP | code (ví dụ) | Ý nghĩa |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body/query không hợp lệ (class-validator) |
| 400 | `JQL_PARSE_ERROR` | Cú pháp JQL sai (kèm `details.position`) |
| 401 | `UNAUTHENTICATED` | Thiếu / sai access token |
| 401 | `TOKEN_EXPIRED` | Access token hết hạn → client gọi refresh |
| 403 | `FORBIDDEN` | Thiếu permission |
| 404 | `*_NOT_FOUND` | Resource không tồn tại / ngoài scope (cố tình mơ hồ để tránh enumeration) |
| 409 | `CONFLICT` / `INVALID_TRANSITION` | Vi phạm ràng buộc (vd workflow transition không hợp lệ) |
| 409 | `IDEMPOTENCY_CONFLICT` | Idempotency-Key trùng với payload khác |
| 422 | `BUSINESS_RULE_VIOLATION` | Hợp lệ về schema nhưng vi phạm rule (vd sprint đã đóng) |
| 429 | `RATE_LIMITED` | Vượt rate limit (kèm `Retry-After`) |
| 503 | `AI_UNAVAILABLE` | Thiếu/lỗi Anthropic API key — AI degrade gracefully |

### 2.2. NestJS implementation hint
```ts
// Tất cả service throw HttpException custom (AppException) mang { code, statusCode, details }
// Validation: ValidationPipe({ whitelist: true, transform: true, exceptionFactory })
//   → map class-validator errors thành details[]
```

---

## 3. Auth resource — `/api/v1/auth`

Giao tiếp với subsystem **Auth (JWT)**. Access token TTL 15m, refresh token TTL 7d (rotating, lưu hashed trong DB + httpOnly cookie tùy chọn).

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/auth/register` | public | Đăng ký user + tạo org mặc định |
| POST | `/auth/login` | public | Đăng nhập, trả access + refresh |
| POST | `/auth/refresh` | refresh token | Rotate token cặp mới |
| POST | `/auth/logout` | access | Revoke refresh token hiện tại |
| GET | `/auth/me` | access | Profile + memberships + permissions hiện tại |
| POST | `/auth/forgot-password` | public | Gửi email reset (degrade nếu thiếu SMTP) |
| POST | `/auth/reset-password` | public(token) | Đặt lại mật khẩu bằng reset token |

**DTO chính:**
```ts
// POST /auth/register
class RegisterDto {
  email: string;        // @IsEmail
  password: string;     // @MinLength(8) @Matches(strongPwd)
  fullName: string;     // @IsNotEmpty
  orgName?: string;     // nếu thiếu → "{fullName}'s Org"
}

// POST /auth/login
class LoginDto { email: string; password: string; }

// Response (login & refresh)
class AuthTokensDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;          // seconds đến khi access hết hạn
  tokenType: 'Bearer';
  user: UserDto;
}

// POST /auth/refresh
class RefreshDto { refreshToken: string; } // hoặc đọc từ httpOnly cookie

// GET /auth/me → response
class MeDto {
  user: UserDto;
  memberships: { orgId: string; role: string; }[];
  permissions: string[];      // flatten permission keys cho org hiện tại
}
```

---

## 4. Users resource — `/api/v1/users`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/users` | `user:read` | List user trong org (cursor, hỗ trợ `?q=` search theo tên/email) |
| GET | `/users/{id}` | `user:read` | Chi tiết user |
| PATCH | `/users/me` | — (self) | Cập nhật profile của chính mình |
| PATCH | `/users/{id}` | `user:manage` | Admin cập nhật user khác |
| GET | `/users/{id}/assigned-issues` | `issue:read` | Issue đang assign cho user (cursor) |

```ts
class UserDto {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  createdAt: string;
}
class UpdateUserDto { fullName?: string; avatarUrl?: string; }
```

---

## 5. Organizations & Members — `/api/v1/orgs`

Multi-tenant root. Mỗi resource con scope theo `orgId` (từ token).

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/orgs` | access | Org mà user là thành viên |
| GET | `/orgs/{orgId}` | `org:read` | Chi tiết org |
| PATCH | `/orgs/{orgId}` | `org:manage` | Cập nhật org (name, logo, settings) |
| GET | `/orgs/{orgId}/members` | `org:read` | List member + role (offset) |
| POST | `/orgs/{orgId}/members` | `org:manage` | Mời member (email + role) — degrade email |
| PATCH | `/orgs/{orgId}/members/{userId}` | `org:manage` | Đổi role member |
| DELETE | `/orgs/{orgId}/members/{userId}` | `org:manage` | Gỡ member |
| GET | `/orgs/{orgId}/roles` | `org:read` | List role + permission (giao tiếp RBAC) |

```ts
class OrgDto { id: string; name: string; slug: string; logoUrl: string|null; createdAt: string; }
class InviteMemberDto { email: string; roleId: string; }
class UpdateMemberRoleDto { roleId: string; }
```

---

## 6. Projects resource — `/api/v1/projects`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/projects` | `project:read` | List project trong org (cursor, `?q=`, `?archived=`) |
| POST | `/projects` | `project:create` | Tạo project (key tự sinh hoặc chỉ định) |
| GET | `/projects/{id}` | `project:read` | Chi tiết + counts |
| PATCH | `/projects/{id}` | `project:manage` | Cập nhật |
| DELETE | `/projects/{id}` | `project:manage` | Archive/soft-delete |
| GET | `/projects/{id}/members` | `project:read` | Member của project (team) |
| POST | `/projects/{id}/members` | `project:manage` | Thêm member vào project |
| DELETE | `/projects/{id}/members/{userId}` | `project:manage` | Gỡ member |
| GET | `/projects/{id}/issue-types` | `project:read` | Issue types khả dụng + custom fields config |
| GET | `/projects/{id}/components` | `project:read` | Components/labels |

```ts
class CreateProjectDto {
  name: string;                         // @IsNotEmpty
  key?: string;                         // @Matches(/^[A-Z][A-Z0-9]{1,9}$/) — vd "PROJ"; auto nếu thiếu
  description?: string;
  leadUserId?: string;
  defaultBoardType?: 'KANBAN' | 'SCRUM'; // default SCRUM
  workflowId?: string;                  // mặc định workflow của org
}
class ProjectDto {
  id: string; key: string; name: string; description: string|null;
  leadUserId: string|null; defaultBoardType: 'KANBAN'|'SCRUM';
  workflowId: string;
  counts: { issues: number; openIssues: number; sprints: number; };
  archivedAt: string|null; createdAt: string;
}
```

`key` được dùng làm prefix cho issue key (`PROJ-128`). Việc sinh số chạy (`128`) là sequence per-project — giao tiếp với subsystem **Persistence** (atomic counter trong transaction).

---

## 7. Issues resource — `/api/v1/issues` (core)

Issue type: `EPIC | STORY | TASK | BUG | SUBTASK`. Hỗ trợ custom fields (giao tiếp **Persistence**: bảng `CustomFieldValue`).

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/issues` | `issue:read` | List/search issue (cursor). Hỗ trợ `?jql=` (xem §13) hoặc filter rời |
| POST | `/issues` | `issue:create` | Tạo issue |
| GET | `/issues/{id}` | `issue:read` | Chi tiết đầy đủ (custom fields, subtasks, links) |
| PATCH | `/issues/{id}` | `issue:update` | Partial update (title, desc, assignee, priority, points, custom fields…) |
| DELETE | `/issues/{id}` | `issue:delete` | Xóa (soft) |
| POST | `/issues/{id}/transitions` | `issue:transition` | Đổi status theo workflow transition |
| POST | `/issues/{id}/move` | `issue:update` | Di chuyển vị trí trên board/backlog (rank + status/sprint) |
| POST | `/issues/{id}/subtasks` | `issue:create` | Tạo subtask |
| GET | `/issues/{id}/links` | `issue:read` | Liên kết (blocks, relates, duplicates) |
| POST | `/issues/{id}/links` | `issue:update` | Tạo link tới issue khác |
| DELETE | `/issues/{id}/links/{linkId}` | `issue:update` | Xóa link |
| GET | `/issues/{id}/activity` | `issue:read` | Activity log của issue (cursor) — giao tiếp Notifications/Activity |
| GET | `/issues/{id}/watchers` | `issue:read` | Danh sách watcher |
| POST | `/issues/{id}/watchers` | `issue:read` | Tự watch / thêm watcher |

### 7.1. DTOs

```ts
class CreateIssueDto {
  projectId: string;                    // @IsCuid
  type: 'EPIC'|'STORY'|'TASK'|'BUG'|'SUBTASK';
  title: string;                        // @IsNotEmpty @MaxLength(255)
  description?: string;                 // rich text (ProseMirror/markdown JSON string)
  assigneeId?: string;
  reporterId?: string;                  // default = caller
  priority?: 'LOWEST'|'LOW'|'MEDIUM'|'HIGH'|'HIGHEST'; // default MEDIUM
  storyPoints?: number;                 // @Min(0) @Max(100)
  parentId?: string;                    // cho SUBTASK / story-under-epic
  epicId?: string;
  sprintId?: string;
  labels?: string[];
  componentIds?: string[];
  customFields?: Record<string, unknown>; // key = customFieldId
  // idempotent qua header Idempotency-Key
}

class UpdateIssueDto {                   // tất cả optional (PATCH)
  title?: string; description?: string; assigneeId?: string|null;
  priority?: Priority; storyPoints?: number|null;
  labels?: string[]; componentIds?: string[];
  epicId?: string|null; sprintId?: string|null;
  customFields?: Record<string, unknown>;
}

class TransitionIssueDto {
  transitionId: string;                 // id transition trong workflow (không phải statusId trực tiếp)
  comment?: string;                     // optional ghi chú khi transition
  resolution?: string;                  // vd "DONE", "WONT_DO"
}

class MoveIssueDto {
  // dùng cho drag-drop board & backlog reorder
  targetStatusId?: string;              // kanban: đổi cột
  targetSprintId?: string|null;         // scrum: đổi sprint / về backlog
  // ranking: lexorank — chỉ cần truyền neighbor, server tính rank
  beforeIssueId?: string|null;
  afterIssueId?: string|null;
}

class IssueDto {
  id: string;
  key: string;                          // "PROJ-128"
  projectId: string;
  type: IssueType;
  title: string;
  description: string|null;
  status: { id: string; name: string; category: 'TODO'|'IN_PROGRESS'|'DONE'; };
  priority: Priority;
  storyPoints: number|null;
  assignee: UserMiniDto|null;
  reporter: UserMiniDto;
  parentId: string|null;
  epicId: string|null;
  sprintId: string|null;
  labels: string[];
  components: { id: string; name: string; }[];
  rank: string;                         // lexorank
  customFields: Record<string, unknown>;
  commentCount: number;
  attachmentCount: number;
  watcherCount: number;
  createdAt: string;
  updatedAt: string;
}
class UserMiniDto { id: string; fullName: string; avatarUrl: string|null; }
```

### 7.2. Lưu ý transition (giao tiếp Workflows §12)
`POST /issues/{id}/transitions` **không** nhận `statusId` trực tiếp — nhận `transitionId`. Server validate transition có hợp lệ từ status hiện tại không (theo workflow của project). Nếu không → `409 INVALID_TRANSITION`. Khi thành công, server emit WS event `issue.transitioned` (§9.4).

### 7.3. Ranking (drag-drop)
Dùng **LexoRank** string. Khi `move`, server chỉ cần `beforeIssueId`/`afterIssueId` để tính rank giữa 2 neighbor → tránh re-index toàn bảng. Map Prisma: `rank String` field, `orderBy: { rank: 'asc' }`.

---

## 8. Boards, Sprints, Backlog

### 8.1. Boards — `/api/v1/boards`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/projects/{projectId}/boards` | `board:read` | List board của project |
| POST | `/projects/{projectId}/boards` | `board:manage` | Tạo board (Kanban/Scrum) |
| GET | `/boards/{id}` | `board:read` | Cấu hình board (columns ↔ statuses, swimlanes, WIP limits) |
| PATCH | `/boards/{id}` | `board:manage` | Cập nhật cấu hình |
| GET | `/boards/{id}/issues` | `board:read` | Issue trên board, group theo column; hỗ trợ `?sprintId=`, `?jql=` filter overlay |

```ts
class BoardDto {
  id: string; projectId: string; name: string;
  type: 'KANBAN'|'SCRUM';
  columns: { id: string; name: string; statusIds: string[]; wipLimit: number|null; order: number; }[];
  swimlaneBy: 'NONE'|'ASSIGNEE'|'EPIC'|'PRIORITY';
}
// GET /boards/{id}/issues response
class BoardIssuesDto {
  columns: { columnId: string; issues: IssueDto[]; }[];
  // Kanban: tất cả issue active; Scrum: chỉ issue trong sprint active (hoặc ?sprintId)
}
```

### 8.2. Sprints — `/api/v1/sprints`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/projects/{projectId}/sprints` | `sprint:read` | List sprint (`?state=`) |
| POST | `/projects/{projectId}/sprints` | `sprint:manage` | Tạo sprint |
| GET | `/sprints/{id}` | `sprint:read` | Chi tiết sprint + issues + tổng points |
| PATCH | `/sprints/{id}` | `sprint:manage` | Cập nhật (name, goal, dates) |
| POST | `/sprints/{id}/start` | `sprint:manage` | Bắt đầu sprint (state ACTIVE) |
| POST | `/sprints/{id}/complete` | `sprint:manage` | Đóng sprint, chuyển issue chưa done về backlog / sprint kế |
| DELETE | `/sprints/{id}` | `sprint:manage` | Xóa sprint (PLANNED only) |

```ts
class CreateSprintDto { name: string; goal?: string; startDate?: string; endDate?: string; }
class CompleteSprintDto { moveUnfinishedTo: 'BACKLOG' | string; } // string = targetSprintId
class SprintDto {
  id: string; projectId: string; name: string; goal: string|null;
  state: 'PLANNED'|'ACTIVE'|'COMPLETED';
  startDate: string|null; endDate: string|null; completedAt: string|null;
  stats: { totalPoints: number; completedPoints: number; issueCount: number; };
}
```

### 8.3. Backlog — `/api/v1/projects/{projectId}/backlog`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/projects/{projectId}/backlog` | `issue:read` | Issue chưa thuộc sprint active/completed, sort theo rank (cursor) |

> Đưa issue vào sprint / reorder backlog → dùng `POST /issues/{id}/move` với `targetSprintId`.

---

## 9. Comments & Attachments

### 9.1. Comments — `/api/v1/issues/{issueId}/comments`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/issues/{issueId}/comments` | `comment:read` | List comment (cursor, `sort=createdAt:asc`) |
| POST | `/issues/{issueId}/comments` | `comment:create` | Tạo comment (+ @mentions) |
| PATCH | `/comments/{id}` | `comment:update` (own) | Sửa comment của mình |
| DELETE | `/comments/{id}` | `comment:delete` | Xóa (own hoặc admin) |

```ts
class CreateCommentDto {
  body: string;                         // rich text JSON
  mentions?: string[];                  // userId được @mention → trigger notification
  parentId?: string;                    // threaded reply
}
class CommentDto {
  id: string; issueId: string; author: UserMiniDto;
  body: string; mentions: UserMiniDto[];
  parentId: string|null; edited: boolean;
  createdAt: string; updatedAt: string;
}
```
Tạo comment → emit WS `comment.added` (§9.x WS) + tạo notification cho watcher & mention (giao tiếp **Notifications**).

### 9.2. Attachments — `/api/v1/issues/{issueId}/attachments`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| POST | `/issues/{issueId}/attachments` | `attachment:create` | Upload (multipart) — hoặc presigned 2 bước |
| GET | `/issues/{issueId}/attachments` | `attachment:read` | List |
| GET | `/attachments/{id}/download` | `attachment:read` | Stream / redirect signed URL |
| DELETE | `/attachments/{id}` | `attachment:delete` | Xóa |

```ts
// multipart field "file"; giới hạn 25MB; whitelist mime
class AttachmentDto {
  id: string; issueId: string; filename: string;
  mimeType: string; size: number;
  url: string;                          // signed/relative
  uploadedBy: UserMiniDto; createdAt: string;
}
```
Storage local (volume) cho dev; abstraction `StorageService` để chuyển S3 sau (giao tiếp **Persistence/Infra**).

---

## 10. Search — `/api/v1/search`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/search/issues` | `issue:read` | Tìm issue bằng JQL-like (§13). `?jql=...&limit=&cursor=&sort=` |
| POST | `/search/issues` | `issue:read` | Body version (JQL dài) `{ jql, limit, cursor, sort }` |
| GET | `/search/suggest` | `issue:read` | Autocomplete cho JQL builder: `?type=field\|value&field=&q=` |
| POST | `/search/semantic` | `issue:read` | Semantic search (AI) — degrade về full-text nếu thiếu key (giao tiếp **AI**) |

```ts
class JqlSearchDto { jql: string; limit?: number; cursor?: string; sort?: string; }
// response: cursor envelope (§1.1) với data: IssueDto[]
// thêm field "total" (ước lượng, optional) và "jqlWarnings": string[]

class SemanticSearchDto { query: string; projectId?: string; topK?: number; }
// response: { data: { issue: IssueDto; score: number; }[]; mode: 'SEMANTIC'|'FULLTEXT_FALLBACK'; }
```

---

## 11. Workflows — `/api/v1/workflows`

Định nghĩa statuses + transitions tùy biến (giao tiếp **Issues** §7.2).

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/orgs/{orgId}/workflows` | `workflow:read` | List workflow |
| POST | `/orgs/{orgId}/workflows` | `workflow:manage` | Tạo workflow |
| GET | `/workflows/{id}` | `workflow:read` | Chi tiết: statuses + transitions graph |
| PATCH | `/workflows/{id}` | `workflow:manage` | Cập nhật (rename, thêm/sửa status/transition) |
| DELETE | `/workflows/{id}` | `workflow:manage` | Xóa (nếu không project nào dùng) |

```ts
class WorkflowDto {
  id: string; orgId: string; name: string; isDefault: boolean;
  statuses: { id: string; name: string; category: 'TODO'|'IN_PROGRESS'|'DONE'; order: number; }[];
  transitions: {
    id: string; name: string;
    from: string[] | '*';               // '*' = từ bất kỳ status (global transition)
    to: string;                         // statusId đích
    requiresResolution?: boolean;
    allowedRoles?: string[];            // optional gate theo role (RBAC)
  }[];
}
```
**Validation rule:** mỗi workflow phải có đúng ít nhất 1 status category `DONE` và 1 `TODO`. Transition `to` phải trỏ status tồn tại trong cùng workflow.

---

## 12. Notifications & Activity — `/api/v1/notifications`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/notifications` | self | List notification của user (cursor, `?unread=true`) |
| PATCH | `/notifications/{id}/read` | self | Đánh dấu đã đọc |
| POST | `/notifications/read-all` | self | Đánh dấu tất cả đã đọc |
| GET | `/notifications/unread-count` | self | Badge count |
| GET | `/projects/{projectId}/activity` | `project:read` | Activity feed project (cursor) |

```ts
class NotificationDto {
  id: string;
  type: 'ISSUE_ASSIGNED'|'MENTIONED'|'COMMENT_ADDED'|'ISSUE_TRANSITIONED'|'SPRINT_STARTED'|...;
  title: string; body: string;
  entity: { kind: 'ISSUE'|'COMMENT'|'SPRINT'; id: string; key?: string; };
  actor: UserMiniDto;
  read: boolean; createdAt: string;
}
```
Notification được sinh server-side khi có event (assign, mention, comment, transition…) và push realtime qua WS `notification.created` tới room user (§14.6).

---

## 13. Dashboards & Reports — `/api/v1/dashboards`, `/api/v1/reports`

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/dashboards` | `dashboard:read` | List dashboard của user/org |
| POST | `/dashboards` | `dashboard:create` | Tạo dashboard tùy biến |
| GET | `/dashboards/{id}` | `dashboard:read` | Layout + widgets config |
| PATCH | `/dashboards/{id}` | `dashboard:manage` | Cập nhật layout/widget |
| DELETE | `/dashboards/{id}` | `dashboard:manage` | Xóa |
| GET | `/reports/burndown` | `report:read` | `?sprintId=` → series burndown |
| GET | `/reports/velocity` | `report:read` | `?projectId=&last=6` → velocity N sprint |
| GET | `/reports/cumulative-flow` | `report:read` | `?projectId=&boardId=&from=&to=` → CFD |
| GET | `/reports/export` | `report:read` | `?type=burndown&format=pdf\|xlsx&...` → file stream |

```ts
class DashboardDto {
  id: string; name: string; ownerId: string; scope: 'PRIVATE'|'ORG';
  widgets: {
    id: string; type: 'BURNDOWN'|'VELOCITY'|'CFD'|'ISSUE_COUNT'|'JQL_TABLE'|'PIE_BY_STATUS';
    title: string;
    config: Record<string, unknown>;    // vd { projectId, jql, sprintId }
    layout: { x: number; y: number; w: number; h: number; }; // react-grid-layout
  }[];
}
// Burndown response
class BurndownDto {
  sprintId: string;
  ideal: { date: string; remaining: number; }[];
  actual: { date: string; remaining: number; }[];
  scopeChanges: { date: string; delta: number; reason: string; }[];
}
// Velocity
class VelocityDto { sprints: { sprintId: string; name: string; committed: number; completed: number; }[]; }
```
Export PDF/Excel: server render (PDF: headless/`pdfkit`; Excel: `exceljs`) → stream với `Content-Disposition: attachment`. Format heavy chart có thể nhận dataURL từ frontend (giao tiếp **Frontend/Analytics**).

---

## 14. AI resource — `/api/v1/ai` (giao tiếp subsystem AI)

**Nguyên tắc degrade gracefully:** nếu `ANTHROPIC_API_KEY` trống/lỗi → trả `503 AI_UNAVAILABLE` với `{ degraded: true, fallback?: ... }`. Frontend ẩn/disable nút AI dựa trên `GET /ai/capabilities`.

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/ai/capabilities` | access | Cờ tính năng AI khả dụng (key có/không, model nào) |
| POST | `/ai/issues/generate` | `issue:create` | Sinh 1+ issue từ NL prompt |
| POST | `/ai/issues/{id}/summarize` | `issue:read` | Tóm tắt issue + comments |
| POST | `/ai/issues/{id}/suggest` | `issue:read` | Gợi ý assignee / priority / storyPoints |
| POST | `/ai/sprints/plan` | `sprint:manage` | Sprint planning assistant (chọn issue theo capacity) |
| POST | `/ai/search/semantic` | `issue:read` | (= §10 semantic) |
| POST | `/ai/chat` | access | Trợ lý hội thoại (streaming SSE) |

```ts
class AiCapabilitiesDto {
  available: boolean;
  defaultModel: 'claude-opus-4-8' | 'claude-sonnet-4-6';
  features: {
    generateIssues: boolean; summarize: boolean; suggest: boolean;
    sprintPlanning: boolean; semanticSearch: boolean; chat: boolean;
  };
}
class GenerateIssuesDto {
  projectId: string;
  prompt: string;                       // NL: "Build login with OAuth, 2FA, rate limit"
  preferredType?: IssueType;
  autoCreate?: boolean;                 // false = chỉ preview, true = tạo luôn
}
// response
class GenerateIssuesResultDto {
  model: string;
  proposals: {
    type: IssueType; title: string; description: string;
    storyPoints?: number; priority?: Priority;
    subtasks?: { title: string }[];
  }[];
  created?: IssueDto[];                  // nếu autoCreate
  degraded?: boolean;
}
class SuggestDto { fields: ('assignee'|'priority'|'storyPoints')[]; }
class SuggestResultDto {
  assignee?: { userId: string; confidence: number; reason: string; };
  priority?: { value: Priority; confidence: number; };
  storyPoints?: { value: number; confidence: number; };
  model: string; degraded?: boolean;
}
class SprintPlanDto { projectId: string; capacityPoints: number; sprintGoal?: string; }
```
- `/ai/chat` dùng **SSE** (`text/event-stream`) hoặc WS `ai.chat.token` (§14.7) cho streaming token. Model chọn theo task: tóm tắt/suggest → `claude-sonnet-4-6`; generate/plan phức tạp → `claude-opus-4-8`. Server giữ system prompt + tool definitions; client chỉ gửi nội dung.
- AI tốn thời gian → các endpoint nặng có thể trả `202 Accepted` + jobId, kết quả push qua WS (`ai.job.completed`). Mặc định sync cho prompt ngắn.

---

## 15. WebSocket Contract (Socket.io)

### 15.1. Kết nối & namespace

| Mục | Giá trị |
|---|---|
| Namespace chính | `/realtime` |
| Auth | Handshake `auth: { token: <accessToken> }` → `WsJwtGuard` validate; reject `connect_error` nếu sai |
| Transport | websocket (fallback polling), `pingInterval=25s`, `pingTimeout=20s` |
| Adapter | `@socket.io/redis-adapter` (Redis) để scale đa instance — giao tiếp **Infra** |

```ts
// client
const socket = io('/realtime', { auth: { token }, transports: ['websocket'] });
```

### 15.2. Rooms (multi-tenant scoping)

Server tự join room dựa trên membership; client gọi explicit join cho entity đang xem.

| Room name | Mục đích | Join khi |
|---|---|---|
| `user:{userId}` | Notification cá nhân | auto on connect |
| `org:{orgId}` | Sự kiện org-level | auto on connect |
| `project:{projectId}` | Activity, presence project | client emit `subscribe:project` |
| `board:{boardId}` | Board updates (drag-drop realtime) | client emit `subscribe:board` |
| `issue:{issueId}` | Issue detail (comment, typing, presence) | client emit `subscribe:issue` |

**Client → Server (subscribe/unsubscribe):**
```ts
socket.emit('subscribe:project', { projectId });
socket.emit('subscribe:board',   { boardId });
socket.emit('subscribe:issue',   { issueId });
socket.emit('unsubscribe',       { room: 'issue:clz3k...' });
// server kiểm tra quyền truy cập room trước khi join; ack callback { ok: boolean, error? }
```

### 15.3. Event envelope chuẩn

Mọi server→client event payload theo cấu trúc:
```jsonc
{
  "event": "issue.updated",
  "room": "board:clz3k...",
  "actorId": "clzUser...",      // ai gây ra (để client bỏ qua echo của chính mình nếu optimistic)
  "ts": "2026-06-24T08:30:00.000Z",
  "data": { /* payload theo event */ },
  "version": 7                   // optimistic concurrency: số version của entity sau update
}
```

### 15.4. Event catalog — Issues & Board

| Event (server→client) | Room | data | Trigger REST |
|---|---|---|---|
| `issue.created` | `project:{id}`, `board:{id}` | `IssueDto` | POST /issues |
| `issue.updated` | `issue:{id}`, `board:{id}` | `{ id, changes: Partial<IssueDto>, version }` | PATCH /issues/{id} |
| `issue.moved` | `board:{id}` | `{ id, fromColumnId, toColumnId, fromSprintId, toSprintId, rank, version }` | POST /issues/{id}/move |
| `issue.transitioned` | `issue:{id}`, `board:{id}` | `{ id, fromStatusId, toStatusId, resolution }` | POST /issues/{id}/transitions |
| `issue.deleted` | `project:{id}`, `board:{id}` | `{ id }` | DELETE /issues/{id} |

### 15.5. Event catalog — Comments

| Event | Room | data |
|---|---|---|
| `comment.added` | `issue:{id}` | `CommentDto` |
| `comment.updated` | `issue:{id}` | `CommentDto` |
| `comment.deleted` | `issue:{id}` | `{ id, issueId }` |

### 15.6. Presence & Typing (client→server và broadcast)

| Direction | Event | data | Ý nghĩa |
|---|---|---|---|
| C→S | `presence:join` | `{ room }` | Thông báo đang xem (server thêm vào presence set Redis) |
| C→S | `presence:leave` | `{ room }` | Rời (cũng tự động on disconnect) |
| S→C | `presence.join` | `{ room, user: UserMiniDto }` | Có người vào |
| S→C | `presence.leave` | `{ room, userId }` | Có người rời |
| S→C | `presence.state` | `{ room, users: UserMiniDto[] }` | Snapshot khi mới join (ack) |
| C→S | `typing:start` | `{ issueId }` | Đang gõ comment |
| C→S | `typing:stop` | `{ issueId }` | Ngưng gõ |
| S→C | `typing` | `{ issueId, userId, isTyping }` | Broadcast tới room `issue:{id}` (trừ actor) |

> Presence dùng Redis set per-room với TTL heartbeat; on disconnect server cleanup và broadcast `presence.leave`. Giao tiếp **Realtime/Infra**.

### 15.7. Event catalog — Notifications, Sprint, AI

| Event | Room | data |
|---|---|---|
| `notification.created` | `user:{userId}` | `NotificationDto` |
| `notification.unreadCount` | `user:{userId}` | `{ count }` |
| `sprint.started` | `project:{id}`, `board:{id}` | `SprintDto` |
| `sprint.completed` | `project:{id}`, `board:{id}` | `{ sprintId, movedCount }` |
| `ai.job.completed` | `user:{userId}` | `{ jobId, kind, result }` |
| `ai.chat.token` | `user:{userId}` (hoặc per-stream room) | `{ streamId, delta, done }` |

### 15.8. Error & ack convention (WS)

- Mọi `C→S` event hỗ trợ **ack callback**: `socket.emit('subscribe:issue', payload, (ack) => {...})` với `ack = { ok: true } | { ok: false, error: { code, message } }`.
- Lỗi không gắn ack → server emit `ws.error`: `{ code, message, event }`.
- Reconnect: client tự re-`subscribe` các room đang active sau `reconnect`. Server **không** giữ subscription qua reconnect.

---

## 16. JQL-like Search Grammar (`jql`)

Cú pháp tối giản, an toàn (parse → AST → Prisma `where`, **không** raw SQL).

### 16.1. Grammar (EBNF)

```ebnf
query        = expression ;
expression   = andExpr , { "OR" , andExpr } ;
andExpr      = condition , { "AND" , condition } ;
condition    = "(" , expression , ")" | comparison ;
comparison   = field , operator , value
             | field , ( "IS" | "IS NOT" ) , "EMPTY" ;
field        = identifier ;                         // whitelist, xem §16.3
operator     = "=" | "!=" | ">" | ">=" | "<" | "<="
             | "~" | "!~"                           // contains / not contains (text)
             | "IN" | "NOT IN" ;
value        = string | number | date | bool | list | function ;
list         = "(" , value , { "," , value } , ")" ;
function     = "currentUser()" | "now()" | "startOfSprint()" | "endOfSprint()" ;
string       = '"' , chars , '"' | identifier ;
date         = '"' , ISO8601 , '"' | relativeDate ; // "-7d", "now()"
```

Hỗ trợ `ORDER BY field [ASC|DESC]` ở cuối (tùy chọn), map sang `orderBy`.

### 16.2. Ví dụ

```sql
status = "In Progress" AND assignee = currentUser()
type IN (BUG, STORY) AND priority >= HIGH AND created >= "-7d"
(labels ~ "payment" OR title ~ "checkout") AND sprint = currentSprint() ORDER BY priority DESC
assignee IS EMPTY AND status != Done
```

### 16.3. Field whitelist → Prisma mapping

| JQL field | Prisma path | Loại | Operator hỗ trợ |
|---|---|---|---|
| `project` | `projectId` / `project.key` | enum-like | `=`, `!=`, `IN` |
| `type` | `type` | enum | `=`, `!=`, `IN` |
| `status` | `status.name` (resolve → statusId) | string→id | `=`, `!=`, `IN` |
| `statusCategory` | `status.category` | enum | `=`, `IN` |
| `priority` | `priority` | ordered enum | `=`,`!=`,`>`,`>=`,`<`,`<=`,`IN` |
| `assignee` | `assigneeId` (resolve email/currentUser) | id | `=`,`!=`,`IN`,`IS EMPTY` |
| `reporter` | `reporterId` | id | `=`,`!=`,`IN` |
| `sprint` | `sprintId` (currentSprint() → active) | id | `=`,`!=`,`IN`,`IS EMPTY` |
| `epic` | `epicId` | id | `=`,`IS EMPTY` |
| `labels` | `labels` (array) | array | `~`(has), `IN`(hasSome) |
| `title` / `summary` | `title` | text | `~`,`!~` |
| `description` | `description` | text | `~` |
| `storyPoints` | `storyPoints` | number | `=`,`!=`,`>`,`>=`,`<`,`<=`,`IS EMPTY` |
| `created` | `createdAt` | date | `>`,`>=`,`<`,`<=`,`=` |
| `updated` | `updatedAt` | date | `>`,`>=`,`<`,`<=` |
| `cf[<fieldId>]` | `customFieldValues` (relation filter) | any | tùy type |

### 16.4. Mapping operator → Prisma

| JQL op | Prisma |
|---|---|
| `=` | `{ field: value }` |
| `!=` | `{ field: { not: value } }` |
| `>` `>=` `<` `<=` | `{ field: { gt/gte/lt/lte: value } }` |
| `~` (text) | `{ field: { contains: value, mode: 'insensitive' } }` |
| `!~` | `{ NOT: { field: { contains: value, mode: 'insensitive' } } }` |
| `IN` | `{ field: { in: [...] } }` |
| `NOT IN` | `{ field: { notIn: [...] } }` |
| `IS EMPTY` | `{ field: null }` (array: `{ isEmpty: true }`) |
| `IS NOT EMPTY` | `{ NOT: { field: null } }` |
| `AND` / `OR` | `{ AND: [...] }` / `{ OR: [...] }` |
| `labels ~ x` | `{ labels: { has: x } }` |

### 16.5. Parser pipeline (NestJS)

```
jql string
  → Lexer (tokenize: FIELD, OP, VALUE, LPAREN, RPAREN, AND, OR, ORDERBY)
  → Parser (Pratt/recursive-descent → AST: { type:'AND'|'OR'|'CMP', ... })
  → Validator (field whitelist + operator hợp lệ + type của value + resolve currentUser()/currentSprint())
  → Prisma WhereBuilder (AST → Prisma.IssueWhereInput, luôn AND thêm { project: { orgId } } để enforce tenant scope)
```
**An toàn:** không bao giờ build raw SQL. Mọi value đi qua Prisma parameterization. Field ngoài whitelist → `400 JQL_PARSE_ERROR` kèm `details.position` (offset ký tự). Giới hạn độ sâu nesting (max 10) và số condition (max 50) chống DoS.

---

## 17. Rate limiting & idempotency

| Nhóm | Giới hạn (mặc định) |
|---|---|
| Auth (`/auth/login`, `/register`, `/refresh`) | 10 req / phút / IP |
| AI endpoints | 20 req / phút / user (nặng), trả `429 RATE_LIMITED` + `Retry-After` |
| Mặc định API | 100 req / phút / user |
| WS events C→S | 30 events / 10s / socket (typing/presence loại trừ phần nào) |

- Implement: `@nestjs/throttler` (storage Redis để dùng chung đa instance).
- **Idempotency:** `POST /issues`, `POST /comments`, AI generate hỗ trợ header `Idempotency-Key`. Server lưu `(key, userId, hash(body)) → response` trong Redis TTL 24h. Trùng key + body khác → `409 IDEMPOTENCY_CONFLICT`.

---

## 18. OpenAPI & type sharing (giao tiếp Frontend)

- Backend dùng `@nestjs/swagger` decorators (`@ApiProperty`, `@ApiResponse`) → sinh `openapi.json` tại `/api/docs-json`, Swagger UI tại `/api/docs`.
- DTO định nghĩa bằng class + class-validator, đặt trong package workspace dùng chung `@tirapro/contracts` (types + zod schemas) để **Frontend** import trực tiếp (single source of truth), tránh lệch contract.
- WS event payload types cũng export từ `@tirapro/contracts` (`WsEvents` discriminated union) cho cả NestJS gateway và React client.

```ts
// @tirapro/contracts/ws.ts
export type WsServerEvent =
  | { event: 'issue.created'; data: IssueDto }
  | { event: 'issue.moved'; data: IssueMovedPayload }
  | { event: 'comment.added'; data: CommentDto }
  | { event: 'presence.join'; data: { room: string; user: UserMiniDto } }
  | { event: 'typing'; data: { issueId: string; userId: string; isTyping: boolean } }
  // ...
  ;
```

---

## 19. Bảng tổng hợp điểm giao tiếp với subsystem khác

| Điểm giao tiếp | Subsystem đối tác | Ràng buộc contract |
|---|---|---|
| Permission key (`@RequirePermission`) | **RBAC** | API tham chiếu key string; RBAC định nghĩa & resolve thực tế |
| Workflow validate transition | **Workflows** | `POST /issues/{id}/transitions` gọi WorkflowService.canTransition() |
| Issue key sequence `PROJ-N` | **Persistence** | Atomic counter per-project trong transaction |
| Custom field values | **Persistence** | Bảng `CustomFieldValue`, JQL `cf[id]` map relation filter |
| Notification sinh & push | **Notifications** | Mọi mutation gọi NotificationService → emit WS `notification.created` |
| WS emit sau mutation | **Realtime** | Service layer phát domain event → Gateway broadcast theo room |
| Redis adapter / presence | **Infra/Realtime** | Socket.io Redis adapter, presence set |
| AI degrade & model chọn | **AI** | `/ai/capabilities` flag; thiếu key → `503 AI_UNAVAILABLE` |
| Type sharing | **Frontend** | Package `@tirapro/contracts` (DTO + zod + WS types) |
| Storage attachment | **Infra/Persistence** | `StorageService` abstraction (local volume → S3) |

---

## 20. Quy ước response thành công (tóm tắt)

- **Detail/Create/Update:** trả thẳng object DTO (không bọc `{ data }` cho single resource) với HTTP `200`/`201`.
- **List:** luôn bọc envelope `{ data, pageInfo }` (§1).
- **Action không trả body:** HTTP `204 No Content`.
- **Async (AI nặng):** HTTP `202 Accepted` + `{ jobId }`, kết quả qua WS `ai.job.completed`.
- Mọi response kèm header `X-Request-Id` để trace xuyên REST ↔ WS ↔ log.