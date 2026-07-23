# Data Model & DB Schema

Tôi đã có đủ thông tin về model Anthropic (`claude-opus-4-8`/`claude-sonnet-4-6`) và lưu ý quan trọng: Anthropic **không cung cấp embedding API** — chỉ có Messages API. Điều này ảnh hưởng trực tiếp đến thiết kế semantic search (cần dùng pgvector + một nguồn embedding khác). Tôi sẽ ghi rõ điểm này trong đặc tả.

Bây giờ tôi viết bản đặc tả thiết kế Data Model & DB Schema đầy đủ.

# Đặc tả Thiết kế: Data Model & DB Schema — Subsystem "Data Model & DB Schema" (Tirapro)

> **Phiên bản:** 1.0 · **Ngày:** 2026-06-24 · **Đối tượng:** Backend (NestJS 10 + Prisma) team, AI team, Realtime team, Frontend team.
> **Phạm vi tài liệu này:** Toàn bộ mô hình dữ liệu persistence layer (PostgreSQL + Prisma) cho Tirapro. Tài liệu này là **single source of truth** cho schema. Các subsystem khác (API, Realtime, AI, Reports) tiêu thụ mô hình này thông qua các điểm giao tiếp được nêu rõ ở mục [13](#13-điểm-giao-tiếp-với-subsystem-khác).

---

## 1. Nguyên tắc thiết kế tổng thể

### 1.1. Quy ước chung (áp dụng cho MỌI entity)

| Quy ước | Quyết định | Lý do |
|---|---|---|
| **Primary key** | `id` kiểu `String @id @default(cuid())` (CUID2 qua `@paralleldrive/cuid2` ở app layer, hoặc `cuid()` builtin của Prisma) | Sortable-ish, URL-safe, không lộ cardinality như auto-increment, sinh được ở client (optimistic UI). Dùng `String` thay vì `Int` để tránh lộ số lượng record. |
| **Audit fields** | `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt` | Bắt buộc trên mọi bảng business. |
| **Created/Updated by** | `createdById String?`, `updatedById String?` (FK → `User`, `onDelete: SetNull`) | Audit trail. Nullable vì có thể do system/seed tạo. |
| **Soft-delete** | `deletedAt DateTime?` (nullable). Bảng có soft-delete đánh dấu rõ trong tài liệu này. | Issue/Project/Comment cần khôi phục được + giữ referential integrity cho ActivityLog. |
| **Tenant scoping** | Mọi entity business mang `workspaceId` (trực tiếp hoặc gián tiếp qua quan hệ) | Multi-tenant isolation. |
| **Timestamps** | Luôn lưu UTC (`timestamptz`). Convert ở presentation layer. | |
| **Enum** | Dùng Prisma `enum` (native PostgreSQL enum). | Type-safe, ràng buộc ở DB. |

### 1.2. Chiến lược Soft-delete

- **Có soft-delete** (`deletedAt`): `Workspace`, `Project`, `Issue`, `Comment`, `Sprint`, `Board`, `CustomField`, `Dashboard`, `SavedFilter`. Lý do: cần khôi phục, hoặc cần giữ lịch sử để ActivityLog/Reports vẫn join được.
- **Hard-delete** (xóa thật): `Attachment` (kèm xóa file vật lý), `Notification`, `ActivityLog` (chỉ purge theo retention policy), bảng nối thuần (`IssueLabel`, `WorkflowTransition`...).
- **Quy ước query:** App layer dùng **Prisma Client Extension** (`$extends`) để tự động thêm `where: { deletedAt: null }` cho các model có soft-delete. Tài liệu hóa rõ để tránh "leak" record đã xóa. Restore = set `deletedAt = null`.

```typescript
// prisma/soft-delete.extension.ts — điểm giao tiếp với API subsystem
export const softDeleteExtension = Prisma.defineExtension({
  query: {
    $allModels: {
      async findMany({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model) && args.where?.deletedAt === undefined) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      // findFirst, findUnique, count, update, updateMany tương tự
    },
  },
});
```

### 1.3. Chiến lược Issue Key (`PROJ-123`)

Đây là yêu cầu nghiệp vụ cốt lõi. Quyết định:

- Mỗi `Project` có `key` (vd `PROJ`, `WEB`) — **unique trong phạm vi `Workspace`**, viết hoa, 2–10 ký tự `[A-Z][A-Z0-9]*`.
- Mỗi `Project` giữ một bộ đếm đơn điệu `issueSequence Int @default(0)`.
- Mỗi `Issue` có `number Int` (số thứ tự trong project) và `key String` (computed/denormalized = `project.key + '-' + number`, vd `PROJ-123`).
- **Cấp phát số an toàn dưới concurrency:** dùng transaction với atomic increment, KHÔNG dùng `MAX(number)+1` (race condition). Cách chuẩn:

```typescript
// IssueKeyService — chạy trong $transaction
async function allocateIssueNumber(tx, projectId: string): Promise<number> {
  // UPDATE ... RETURNING là atomic, an toàn dưới concurrency
  const updated = await tx.project.update({
    where: { id: projectId },
    data: { issueSequence: { increment: 1 } },
    select: { issueSequence: true, key: true },
  });
  return updated.issueSequence; // number = giá trị sau khi increment
}
```

- `Issue.key` được lưu denormalized (để JQL search, hiển thị, index nhanh) nhưng **immutable** sau khi tạo. Nếu đổi `Project.key` (hiếm), cần migration job cập nhật toàn bộ `Issue.key` của project đó (thiết kế ở mục [9.3](#93-đổi-project-key)).
- **Unique constraint:** `@@unique([projectId, number])` và `@@unique([key])` toàn cục (vì key đã chứa project key, unique trong workspace → đảm bảo unique toàn cục nếu project.key unique trong workspace; để an toàn dùng `@@unique([workspaceId, key])`).

### 1.4. Lưu ý về AI & Anthropic Claude

> **CRITICAL — Anthropic không có embedding API.** Tech stack chốt dùng Anthropic Claude (`claude-opus-4-8` / `claude-sonnet-4-6`) cho generation/summarization/suggestion. Tuy nhiên **Claude API chỉ có Messages API, KHÔNG cung cấp endpoint tạo vector embedding**. Vì vậy semantic search **không thể** sinh embedding từ Claude.
>
> **Quyết định kiến trúc cho semantic search:**
> 1. **Vector store:** dùng extension PostgreSQL `pgvector` (cột `vector`), giữ mọi thứ trong cùng 1 DB (phù hợp mục tiêu `docker compose up`).
> 2. **Nguồn embedding:** cấu hình pluggable qua biến môi trường `EMBEDDING_PROVIDER`. Mặc định degrade gracefully:
>    - Nếu có embedding provider (vd local model `Xenova/all-MiniLM-L6-v2` chạy qua `transformers.js` trong Node, 384 chiều — **không cần API key, chạy offline**) → bật semantic search.
>    - Nếu không cấu hình → semantic search **degrade về full-text search** (PostgreSQL `tsvector`/`pg_trgm`), không làm app vỡ.
> 3. Schema phải hỗ trợ **cả hai**: cột `embedding vector(N)` (nullable) cho semantic + cột `searchVector tsvector` (generated) cho full-text. Dimension `N` cố định = 384 (MiniLM); đặt qua Prisma `Unsupported` type vì Prisma chưa hỗ trợ native `vector`.

Claude vẫn được dùng cho: sinh issue từ NL, tóm tắt, gợi ý assignee/priority/story points, sprint planning. Các kết quả này lưu vào bảng `AiSuggestion` / `AiGenerationLog` (mục [8](#8-ai--analytics-support)).

---

## 2. Sơ đồ quan hệ tổng quát (ERD logic)

```
Workspace 1──n Project 1──n Issue ──┬── n Comment
   │             │            │      ├── n Attachment
   │             │            │      ├── n IssueLink (self n-n)
   │             │            │      ├── n CustomFieldValue
   │             │            │      ├── n IssueLabel (n-n Label)
   │             │            │      └── n IssueComponent (n-n Component)
   │             │            │
   │             │            └── belongsTo Sprint / Status / IssueType / Epic(self)
   │             │
   │             ├── n Board 1──n BoardColumn ──n Status (mapping)
   │             ├── n Sprint
   │             ├── n Workflow 1──n Status, 1──n Transition
   │             ├── n Label / Component / Version
   │             ├── n CustomField 1──n CustomFieldOption
   │             └── n ProjectMembership (n-n User ↔ Role)
   │
   ├── n WorkspaceMembership (n-n User ↔ Role)
   ├── n Role 1──n RolePermission ──n Permission
   ├── n SavedFilter
   ├── n Dashboard 1──n DashboardWidget
   ├── n Notification (per User)
   └── n ActivityLog

User 1──n (mọi audit field, assignee, reporter, author...)
RefreshToken n──1 User
```

---

## 3. Identity, Tenancy & RBAC

### 3.1. `User`

| Trường | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | String | PK cuid | |
| `email` | String | `@unique`, citext (lowercase) | Đăng nhập |
| `passwordHash` | String? | nullable | Null nếu chỉ dùng OAuth (mở rộng sau) |
| `displayName` | String | | |
| `avatarUrl` | String? | | |
| `timezone` | String | `@default("UTC")` | IANA tz, ảnh hưởng reports/notifications |
| `locale` | String | `@default("en")` | |
| `status` | `UserStatus` enum | `@default(ACTIVE)` | ACTIVE / DEACTIVATED / INVITED |
| `lastSeenAt` | DateTime? | | Cho presence (Realtime) |
| `isSystemAdmin` | Boolean | `@default(false)` | Super-admin toàn hệ thống |
| audit | createdAt/updatedAt | | |

- Index: `@@index([email])` (đã có qua unique), `@@index([status])`.
- **Không** soft-delete user → dùng `status = DEACTIVATED` (giữ FK assignee/reporter lịch sử).

### 3.2. `Workspace` (= Organization)

Tenant boundary cao nhất. Một user có thể thuộc nhiều workspace.

| Trường | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | String | PK | |
| `name` | String | | |
| `slug` | String | `@unique` | URL: `/{slug}/...` |
| `ownerId` | String | FK → User | Người tạo |
| `plan` | `WorkspacePlan` enum | `@default(FREE)` | FREE/PRO/ENTERPRISE (chỗ mở rộng) |
| `settings` | Json | `@default("{}")` | Cấu hình mềm (vd default workflow) |
| `deletedAt` | DateTime? | soft-delete | |
| audit + createdById/updatedById | | | |

- `@@index([slug])`, `@@index([deletedAt])`.

### 3.3. RBAC: `Permission`, `Role`, `RolePermission`, Membership

**Mô hình RBAC 2 cấp:** Role có thể scope ở `WORKSPACE` hoặc `PROJECT`. Permission là enum cố định (seed sẵn).

#### `Permission` (seed catalog, hiếm khi đổi)
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `key` | `PermissionKey` enum | `@unique` — vd `ISSUE_CREATE`, `ISSUE_DELETE`, `BOARD_MANAGE`, `SPRINT_MANAGE`, `WORKFLOW_EDIT`, `MEMBER_MANAGE`, `PROJECT_ADMIN`, `WORKSPACE_ADMIN` |
| `description` | String | |
| `scope` | `PermissionScope` enum | WORKSPACE / PROJECT |

> Có thể thay bằng enum thuần + bảng nối, nhưng giữ bảng `Permission` để API list/expose dễ. `PermissionKey` enum dưới đây là nguồn chân lý.

#### `Role`
| Trường | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | String | PK | |
| `workspaceId` | String? | FK → Workspace | Null = role hệ thống mặc định (Admin/Member/Viewer) dùng chung |
| `name` | String | | |
| `scope` | `RoleScope` enum | WORKSPACE / PROJECT | |
| `isSystem` | Boolean | `@default(false)` | Role built-in không xóa được |
| audit | | | |

- `@@unique([workspaceId, name, scope])`.

#### `RolePermission` (n-n Role ↔ Permission)
| `roleId` | String | FK, `onDelete: Cascade` |
| `permissionId` | String | FK, `onDelete: Cascade` |
- `@@id([roleId, permissionId])`.

#### `WorkspaceMembership` (n-n User ↔ Workspace + Role)
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `workspaceId` | String | FK Cascade |
| `userId` | String | FK Cascade |
| `roleId` | String | FK |
| `invitedById` | String? | FK → User |
| `joinedAt` | DateTime? | |
| audit | | |
- `@@unique([workspaceId, userId])`, `@@index([userId])`.

#### `ProjectMembership` (n-n User ↔ Project + Role)
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `projectId` | String | FK Cascade |
| `userId` | String | FK Cascade |
| `roleId` | String | FK |
| audit | | |
- `@@unique([projectId, userId])`, `@@index([userId])`, `@@index([projectId])`.

> **Điểm giao tiếp (Auth/RBAC subsystem):** Quyền hiệu lực của user trên 1 issue = union(workspace role permissions) ∪ (project role permissions). API subsystem viết `PermissionGuard` resolve từ các bảng này; cache ở Redis nếu cần (ngoài phạm vi data model).

---

## 4. Project & cấu hình

### 4.1. `Project`

| Trường | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | String | PK | |
| `workspaceId` | String | FK Cascade | |
| `key` | String | 2–10 ký tự `[A-Z][A-Z0-9]*` | Tiền tố issue key |
| `name` | String | | |
| `description` | String? | | |
| `type` | `ProjectType` enum | `@default(SCRUM)` | SCRUM / KANBAN |
| `leadId` | String? | FK → User | Project lead |
| `avatarUrl` | String? | | |
| `issueSequence` | Int | `@default(0)` | **Bộ đếm cấp số issue (mục 1.3)** |
| `defaultWorkflowId` | String? | FK → Workflow | Workflow mặc định cho issue type chưa map riêng |
| `defaultAssigneeMode` | `DefaultAssigneeMode` enum | `@default(UNASSIGNED)` | UNASSIGNED / PROJECT_LEAD |
| `isArchived` | Boolean | `@default(false)` | |
| `settings` | Json | `@default("{}")` | |
| `deletedAt` | DateTime? | soft-delete | |
| audit + createdById | | | |

- **Unique:** `@@unique([workspaceId, key])`, `@@unique([workspaceId, name])`.
- Index: `@@index([workspaceId])`, `@@index([leadId])`, `@@index([deletedAt])`.

### 4.2. `Label`, `Component`, `Version`

Các taxonomy gắn theo project (Jira: Labels có thể global, ở đây scope theo project cho đơn giản; có thể nâng lên workspace sau).

#### `Label`
| `id`, `projectId` (FK Cascade), `name`, `color String?` |
- `@@unique([projectId, name])`.

#### `Component`
| `id`, `projectId` (FK Cascade), `name`, `description String?`, `leadId String?` (FK User) |
- `@@unique([projectId, name])`.

#### `Version` (fix version / release)
| `id`, `projectId`, `name`, `description String?`, `status VersionStatus @default(UNRELEASED)`, `startDate DateTime?`, `releaseDate DateTime?` |
- enum `VersionStatus`: UNRELEASED / RELEASED / ARCHIVED.
- `@@unique([projectId, name])`.

---

## 5. Workflow: Status & Transition

Workflow tùy biến là yêu cầu cốt lõi. Mô hình: mỗi `Project` có ≥1 `Workflow`; `Workflow` định nghĩa tập `Status` và tập `Transition` giữa chúng.

### 5.1. `Workflow`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `projectId` | String | FK Cascade |
| `name` | String | |
| `isDefault` | Boolean | `@default(false)` |
| audit | | |
- `@@unique([projectId, name])`.

### 5.2. `Status`
Status thuộc workflow. Mỗi status có "category" theo chuẩn Jira (To Do / In Progress / Done) để Reports & Board phân loại.

| Trường | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | String | PK | |
| `workflowId` | String | FK Cascade | |
| `name` | String | | vd "To Do", "In Review" |
| `category` | `StatusCategory` enum | | TODO / IN_PROGRESS / DONE |
| `color` | String? | | |
| `order` | Int | `@default(0)` | Thứ tự hiển thị |
| `isInitial` | Boolean | `@default(false)` | Status khởi tạo khi tạo issue |
- `@@unique([workflowId, name])`, `@@index([workflowId])`.
- **Ràng buộc nghiệp vụ (enforce ở app):** mỗi workflow đúng 1 status `isInitial = true`.

> **Điểm giao tiếp (Reports):** `StatusCategory` là chìa khóa cho burndown (DONE = hoàn thành), cumulative flow diagram (group theo category/status).

### 5.3. `WorkflowTransition`
Cạnh có hướng giữa 2 status. `fromStatusId = null` nghĩa là transition "ALL" (từ bất kỳ trạng thái nào — vd "Close").

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `workflowId` | String | FK Cascade |
| `name` | String | vd "Start Progress", "Resolve" |
| `fromStatusId` | String? | FK → Status, null = từ-mọi-trạng-thái |
| `toStatusId` | String | FK → Status (required) |
| `order` | Int | `@default(0)` |
- `@@index([workflowId])`, `@@index([fromStatusId])`, `@@index([toStatusId])`.
- **Validate:** không cho phép tự loop vô nghĩa; `toStatus` & `fromStatus` cùng workflow.

> **App-level guard:** khi đổi `Issue.statusId`, API kiểm tra tồn tại transition hợp lệ `(fromStatusId = currentStatus OR null) → toStatusId = newStatus` trong workflow của issue. Nếu không → 422.

### 5.4. (Tùy chọn) `IssueTypeWorkflow` — map issue type ↔ workflow trong project
| `id`, `projectId`, `issueTypeId`, `workflowId` |
- `@@unique([projectId, issueTypeId])`. Nếu không có entry → dùng `Project.defaultWorkflowId`.

---

## 6. Issue — entity trung tâm

### 6.1. `IssueType`
Scope theo workspace để dùng lại giữa project (Epic/Story/Task/Bug/Sub-task là system types, seed sẵn; cho phép custom).

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `workspaceId` | String | FK Cascade |
| `name` | String | |
| `key` | `IssueTypeKey` enum? | EPIC/STORY/TASK/BUG/SUBTASK — null nếu custom |
| `iconUrl` | String? | |
| `color` | String? | |
| `hierarchyLevel` | Int | `@default(0)` — Epic=1, Standard=0, Sub-task=-1 |
| `isSubtask` | Boolean | `@default(false)` |
| `isSystem` | Boolean | `@default(false)` |
- `@@unique([workspaceId, name])`, `@@index([workspaceId])`.

> `hierarchyLevel` theo chuẩn Jira: Epic (1) > Story/Task/Bug (0) > Sub-task (-1). Dùng để validate quan hệ parent-child.

### 6.2. `Issue` (bảng lớn nhất)

| Trường | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | String | PK | |
| `workspaceId` | String | FK Cascade | Denormalized để query/RBAC nhanh |
| `projectId` | String | FK Cascade | |
| `number` | Int | | Số trong project (mục 1.3) |
| `key` | String | | Denormalized `PROJ-123` |
| `typeId` | String | FK → IssueType | |
| `statusId` | String | FK → Status | Trạng thái hiện tại trong workflow |
| `priority` | `IssuePriority` enum | `@default(MEDIUM)` | HIGHEST/HIGH/MEDIUM/LOW/LOWEST |
| `summary` | String | `@db.VarChar(255)` | Tiêu đề |
| `description` | String? | `@db.Text` | Rich text (lưu JSON/Markdown — quy ước với Frontend) |
| `descriptionFormat` | `RichTextFormat` enum | `@default(MARKDOWN)` | MARKDOWN / TIPTAP_JSON |
| `reporterId` | String? | FK → User SetNull | |
| `assigneeId` | String? | FK → User SetNull | |
| `parentId` | String? | FK → Issue SetNull (self) | Sub-task → parent; Story → Epic |
| `epicId` | String? | FK → Issue SetNull (self) | Liên kết nhanh tới Epic (denormalized cho board) |
| `sprintId` | String? | FK → Sprint SetNull | Sprint hiện tại |
| `storyPoints` | Float? | | Estimation (Scrum) |
| `originalEstimate` | Int? | | giây (time tracking) |
| `remainingEstimate` | Int? | | giây |
| `timeSpent` | Int? | | giây (tổng từ WorkLog) |
| `dueDate` | DateTime? | | |
| `startDate` | DateTime? | | |
| `resolution` | `IssueResolution` enum? | | DONE/WONT_DO/DUPLICATE/CANNOT_REPRODUCE... null nếu chưa resolve |
| `resolvedAt` | DateTime? | | Thời điểm vào status DONE — cho lead/cycle time reports |
| `rank` | String | | **LexoRank** cho drag-drop ordering (mục 6.4) |
| `searchVector` | Unsupported("tsvector")? | | Full-text (generated, mục 8.2) |
| `embedding` | Unsupported("vector(384)")? | | Semantic (mục 8.1) |
| `deletedAt` | DateTime? | soft-delete | |
| `createdById`, `updatedById` | String? | FK User SetNull | |
| audit | createdAt/updatedAt | | |

#### Unique & Index
```prisma
@@unique([projectId, number])
@@unique([workspaceId, key])
@@index([projectId, statusId])      // board column query
@@index([sprintId])                 // sprint board / backlog
@@index([assigneeId])
@@index([reporterId])
@@index([parentId])
@@index([epicId])
@@index([typeId])
@@index([projectId, deletedAt])     // list issues còn sống trong project
@@index([rank])                     // ordering
// GIN index cho searchVector & embedding tạo qua raw migration (mục 8)
```

#### Ràng buộc nghiệp vụ (app-level + một phần DB)
- `parentId`: sub-task chỉ trỏ tới issue cùng project, `parent.hierarchyLevel > self.hierarchyLevel`.
- Một issue không thể là parent của chính nó (chống cycle — validate ở service).
- Khi `status.category == DONE` → set `resolvedAt`, yêu cầu `resolution != null`. Khi rời DONE → clear `resolvedAt`, `resolution`.
- `storyPoints` chỉ áp dụng cho issue không phải sub-task (tùy cấu hình).

### 6.3. Bảng nối của Issue

#### `IssueLabel` (n-n Issue ↔ Label)
`issueId` (FK Cascade), `labelId` (FK Cascade) — `@@id([issueId, labelId])`, `@@index([labelId])`.

#### `IssueComponent` (n-n Issue ↔ Component)
`issueId`, `componentId` — `@@id([issueId, componentId])`.

#### `IssueFixVersion` (n-n Issue ↔ Version)
`issueId`, `versionId`, `type FixVersionType` (FIX / AFFECTS) — `@@id([issueId, versionId, type])`.

#### `IssueLink` (n-n Issue ↔ Issue, có loại quan hệ)
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `sourceIssueId` | String | FK Cascade |
| `targetIssueId` | String | FK Cascade |
| `type` | `IssueLinkType` enum | BLOCKS / IS_BLOCKED_BY / RELATES_TO / DUPLICATES / IS_DUPLICATED_BY / CLONES |
- `@@unique([sourceIssueId, targetIssueId, type])`, `@@index([targetIssueId])`.
- Validate: `sourceIssueId != targetIssueId`.

#### `IssueWatcher` (n-n User theo dõi Issue)
`issueId` (FK Cascade), `userId` (FK Cascade) — `@@id([issueId, userId])`, `@@index([userId])`.
> Dùng cho Notification fan-out.

#### `WorkLog` (time tracking)
| `id`, `issueId` (FK Cascade), `authorId` (FK User), `timeSpent Int` (giây), `startedAt DateTime`, `comment String?`, audit |
- `@@index([issueId])`. Tổng `timeSpent` sync vào `Issue.timeSpent` qua service.

### 6.4. Ordering & Drag-drop — LexoRank

> **Quyết định:** dùng **LexoRank** (rank kiểu chuỗi, vd `"0|i0000o:"`) thay vì `Int position`. Lý do: kéo-thả 1 item giữa 2 item khác chỉ cần update **1 row** (sinh rank ở giữa), không phải reindex cả cột. Quan trọng cho realtime drag-drop mượt + optimistic UI.

- Trường `Issue.rank String` (board/backlog ordering).
- Sprint cũng có thể cần rank riêng cho từng board → nếu yêu cầu rank khác nhau theo board, tách bảng `IssueBoardRank(issueId, boardId, rank)`. Mặc định v1: 1 rank toàn cục trong backlog/board của project (`Issue.rank`).
- Thư viện: `lexorank` (npm) ở service layer. App sinh rank; DB chỉ lưu & index.

---

## 7. Board, Sprint, Backlog

### 7.1. `Board`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `projectId` | String | FK Cascade |
| `name` | String | |
| `type` | `BoardType` enum | KANBAN / SCRUM |
| `filterJql` | String? | JQL lọc issue lên board (mục 10) — null = toàn project |
| `swimlaneConfig` | Json | `@default("{}")` — swimlane theo assignee/epic/none |
| `columnConstraintConfig` | Json | `@default("{}")` — WIP limits |
| `deletedAt` | DateTime? | soft-delete |
| audit | | |
- `@@index([projectId])`.

### 7.2. `BoardColumn`
Cột trên board, map tới ≥1 `Status`.

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `boardId` | String | FK Cascade |
| `name` | String | |
| `order` | Int | |
| `wipLimit` | Int? | giới hạn WIP (Kanban) |
- `@@unique([boardId, name])`, `@@index([boardId])`.

#### `BoardColumnStatus` (n-n Column ↔ Status)
`columnId` (FK Cascade), `statusId` (FK Cascade) — `@@id([columnId, statusId])`.
> Cho phép gộp nhiều status vào 1 cột (vд "In Review" + "In Test" → cột "Review").

### 7.3. `Sprint`
| Trường | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | String | PK | |
| `projectId` | String | FK Cascade | |
| `boardId` | String? | FK SetNull | Board chủ của sprint |
| `name` | String | | |
| `goal` | String? | | |
| `state` | `SprintState` enum | `@default(FUTURE)` | FUTURE / ACTIVE / CLOSED |
| `startDate` | DateTime? | | |
| `endDate` | DateTime? | | (planned end) |
| `completeDate` | DateTime? | | Thời điểm thực sự close |
| `sequence` | Int | `@default(0)` | Thứ tự sprint trong project |
| `deletedAt` | DateTime? | soft-delete | |
| audit | | | |
- `@@index([projectId, state])`, `@@index([boardId])`.
- **Ràng buộc:** mỗi board chỉ 1 sprint `ACTIVE` tại một thời điểm (enforce app-level).

> **Backlog** không phải entity riêng — là **view**: các `Issue` của project có `sprintId = null` (và thỏa board filter), sort theo `rank`. Frontend/API query thẳng.

### 7.4. `SprintReportSnapshot` (cho Reports — burndown/velocity)

> **Vấn đề:** burndown cần biết scope của sprint **tại từng ngày** (story points cam kết, đã thêm/bớt). Không thể tính lại chính xác từ trạng thái hiện tại sau khi sprint đóng. Giải pháp: snapshot.

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `sprintId` | String | FK Cascade |
| `snapshotAt` | DateTime | mốc thời gian (thường daily + lúc start/close) |
| `kind` | `SnapshotKind` enum | START / DAILY / SCOPE_CHANGE / CLOSE |
| `committedPoints` | Float | story points cam kết đầu sprint |
| `completedPoints` | Float | đã DONE tính tới mốc |
| `remainingPoints` | Float | còn lại |
| `addedPoints` | Float | scope thêm vào sau start |
| `removedPoints` | Float | scope bỏ ra |
| `committedCount` | Int | số issue |
| `completedCount` | Int | |
| `payload` | Json? | chi tiết (issue ids theo trạng thái) cho CFD |
- `@@index([sprintId, snapshotAt])`.

> **Điểm giao tiếp (Reports subsystem):** Reports đọc các snapshot này để vẽ burndown chart. Một cron job (Reports/Backend) ghi snapshot `DAILY`. `velocity` = tổng `completedPoints` của các sprint `CLOSE` snapshot. CFD (cumulative flow) đọc `payload` hoặc tính từ `ActivityLog` status-change.

---

## 8. AI & Analytics support

### 8.1. Semantic search — `pgvector`

- Cột `Issue.embedding Unsupported("vector(384)")?` (nullable). Comment cũng có thể có embedding nếu cần semantic trên comment (v1: chỉ Issue).
- **Bảng riêng tùy chọn `EmbeddingDocument`** nếu muốn nhúng nhiều loại object (issue/comment/wiki) thống nhất:

```prisma
model EmbeddingDocument {
  id           String   @id @default(cuid())
  workspaceId  String
  entityType   EmbeddingEntityType  // ISSUE | COMMENT
  entityId     String
  contentHash  String   // tránh re-embed nội dung không đổi
  embedding    Unsupported("vector(384)")
  model        String   // tên model embedding đã dùng
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([entityType, entityId])
  @@index([workspaceId])
}
```

- **Migration thủ công (Prisma không sinh được):** bật extension + tạo HNSW index.

```sql
-- prisma/migrations/xxxx_pgvector/migration.sql
CREATE EXTENSION IF NOT EXISTS vector;

-- index cho cosine distance (semantic search)
CREATE INDEX issue_embedding_hnsw
  ON "Issue" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX embedding_document_hnsw
  ON "EmbeddingDocument" USING hnsw (embedding vector_cosine_ops);
```

> **Degrade gracefully:** nếu `EMBEDDING_PROVIDER` không cấu hình, cột `embedding` để null; semantic query bỏ qua, fallback full-text (8.2). AI subsystem chịu trách nhiệm sinh embedding (qua `transformers.js` local hoặc provider khác) và ghi vào cột này. **Không phụ thuộc Claude** cho embedding.

### 8.2. Full-text search — `tsvector` + `pg_trgm`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- generated column từ summary + description
ALTER TABLE "Issue"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("summary", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B') ||
    to_tsvector('simple', coalesce("key", ''))
  ) STORED;

CREATE INDEX issue_search_gin ON "Issue" USING gin ("searchVector");
CREATE INDEX issue_summary_trgm ON "Issue" USING gin ("summary" gin_trgm_ops); -- fuzzy
```

> Trong Prisma schema khai báo `searchVector Unsupported("tsvector")?` để Prisma "biết" cột tồn tại (introspect-safe) nhưng generated bằng raw SQL.

### 8.3. `AiSuggestion` — lưu gợi ý của Claude

Lưu output suggestion (assignee/priority/story points/summary) để: audit, hiển thị lại, đo chất lượng (accept rate).

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `workspaceId` | String | FK Cascade |
| `issueId` | String? | FK Cascade — null nếu gợi ý lúc tạo (chưa có issue) |
| `kind` | `AiSuggestionKind` enum | ASSIGNEE / PRIORITY / STORY_POINTS / SUMMARY / SPRINT_PLAN / DESCRIPTION |
| `inputContext` | Json | dữ liệu đầu vào (prompt context) |
| `output` | Json | kết quả gợi ý (vd `{ assigneeId, confidence }`) |
| `model` | String | `claude-opus-4-8` / `claude-sonnet-4-6` |
| `status` | `AiSuggestionStatus` enum | PENDING / ACCEPTED / REJECTED / EXPIRED |
| `requestedById` | String? | FK User |
| audit | | |
- `@@index([issueId])`, `@@index([workspaceId, kind])`.

### 8.4. `AiGenerationLog` — quan sát & cost tracking

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `workspaceId` | String? | |
| `userId` | String? | |
| `feature` | String | "generate_issue" / "summarize" / "semantic_search" ... |
| `model` | String | |
| `inputTokens` | Int? | từ `usage.input_tokens` |
| `outputTokens` | Int? | từ `usage.output_tokens` |
| `cacheReadTokens` | Int? | từ `usage.cache_read_input_tokens` |
| `latencyMs` | Int? | |
| `success` | Boolean | |
| `stopReason` | String? | `end_turn` / `refusal` / `max_tokens` ... |
| `errorCode` | String? | |
| `requestId` | String? | `response._request_id` (debug với Anthropic) |
| `createdAt` | DateTime | |
- `@@index([workspaceId, feature, createdAt])`.

> **Điểm giao tiếp (AI subsystem):** AI subsystem gọi Claude với `model: "claude-opus-4-8"`, `thinking: {type: "adaptive"}` cho tác vụ phức tạp (sprint planning), `claude-sonnet-4-6` cho tác vụ throughput cao (tóm tắt hàng loạt). Mọi lời gọi ghi `AiGenerationLog`. Khi thiếu API key → AI features trả `null`/disabled, **không** ghi log lỗi vô hạn, UI ẩn nút AI (degrade gracefully — yêu cầu tech stack).

---

## 9. Custom Fields

Mô hình EAV (Entity-Attribute-Value) có kiểm soát, scope theo project hoặc workspace.

### 9.1. `CustomField`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `workspaceId` | String | FK Cascade |
| `projectId` | String? | FK Cascade — null = áp dụng toàn workspace |
| `name` | String | |
| `type` | `CustomFieldType` enum | TEXT / TEXTAREA / NUMBER / DATE / DATETIME / SELECT / MULTI_SELECT / CHECKBOX / USER / URL |
| `isRequired` | Boolean | `@default(false)` |
| `order` | Int | `@default(0)` |
| `config` | Json | `@default("{}")` — vd min/max, regex |
| `deletedAt` | DateTime? | soft-delete |
| audit | | |
- `@@index([workspaceId])`, `@@index([projectId])`.

### 9.2. `CustomFieldOption` (cho SELECT/MULTI_SELECT)
| `id`, `customFieldId` (FK Cascade), `value String`, `color String?`, `order Int` |
- `@@unique([customFieldId, value])`.

### 9.3. `CustomFieldValue`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `issueId` | String | FK Cascade |
| `customFieldId` | String | FK Cascade |
| `valueText` | String? | `@db.Text` — cho TEXT/TEXTAREA/URL |
| `valueNumber` | Float? | NUMBER |
| `valueDate` | DateTime? | DATE/DATETIME |
| `valueBool` | Boolean? | CHECKBOX |
| `valueUserId` | String? | FK User SetNull — USER |
| `valueOptionIds` | String[] | SELECT/MULTI_SELECT (mảng option id) |
- `@@unique([issueId, customFieldId])`, `@@index([customFieldId])`.

> **Quyết định:** dùng cột typed (`valueText`, `valueNumber`...) thay vì 1 cột `Json` thuần → query/filter/JQL hiệu quả hơn, index được. `valueOptionIds` dùng PostgreSQL array (Prisma `String[]`), có thể GIN index nếu cần filter theo option.

### 9.4. Đổi Project key (xử lý ràng buộc 1.3)
Khi đổi `Project.key`: chạy job trong transaction cập nhật `Issue.key = newKey + '-' + number` cho mọi issue (kể cả deleted) của project, đồng thời ghi `ActivityLog` kiểu `PROJECT_KEY_CHANGED`. `searchVector` tự cập nhật (generated). `embedding` cần re-embed nếu key nằm trong nội dung (thường không cần).

---

## 10. Saved Filter (JQL-like) & Search

### 10.1. `SavedFilter`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `workspaceId` | String | FK Cascade |
| `ownerId` | String | FK User |
| `name` | String | |
| `jql` | String | `@db.Text` — chuỗi JQL-like |
| `astCache` | Json? | AST đã parse (cache để khỏi parse lại) |
| `visibility` | `FilterVisibility` enum | PRIVATE / WORKSPACE / PROJECT |
| `sharedProjectId` | String? | FK Project SetNull (nếu PROJECT) |
| `deletedAt` | DateTime? | soft-delete |
| audit | | |
- `@@index([workspaceId, ownerId])`.

### 10.2. `FilterSubscription` / favorite (tùy chọn)
`filterId`, `userId` — `@@id([filterId, userId])`. Cho "star" filter.

> **Điểm giao tiếp (Search subsystem):** API subsystem parse `jql` → AST → Prisma `where` clause. JQL hỗ trợ: field operators (`status = "In Progress"`, `assignee = currentUser()`, `sprint in openSprints()`), full-text (`text ~ "abc"` → `searchVector @@ to_tsquery`), semantic (`text ~~ "abc"` → ORDER BY embedding cosine distance). Custom field reference qua `cf[<id>]`. Data model chỉ cung cấp các cột/index; logic parser nằm ở Search subsystem.

---

## 11. Comments, Mentions, Attachments

### 11.1. `Comment`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `issueId` | String | FK Cascade |
| `authorId` | String? | FK User SetNull |
| `body` | String | `@db.Text` — rich text |
| `bodyFormat` | `RichTextFormat` enum | `@default(TIPTAP_JSON)` |
| `parentId` | String? | FK Comment SetNull (self) — threaded reply (tùy chọn) |
| `isEdited` | Boolean | `@default(false)` |
| `deletedAt` | DateTime? | soft-delete |
| audit | | |
- `@@index([issueId, createdAt])`, `@@index([authorId])`.

### 11.2. `Mention` (n-n: ai được @ trong comment/issue)
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `mentionedUserId` | String | FK User Cascade |
| `commentId` | String? | FK Comment Cascade |
| `issueId` | String? | FK Issue Cascade (mention trong description) |
| `createdAt` | DateTime | |
- `@@index([mentionedUserId])`, `@@index([commentId])`.

> **Điểm giao tiếp (Notification):** khi parse `@mention` từ body, tạo `Mention` + đẩy `Notification` kiểu `MENTIONED`. Watcher list (`IssueWatcher`) + assignee + reporter cũng nhận notification theo loại sự kiện.

### 11.3. `Attachment`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `issueId` | String? | FK Cascade — có thể null nếu đính vào comment |
| `commentId` | String? | FK Cascade |
| `uploadedById` | String? | FK User SetNull |
| `fileName` | String | tên gốc |
| `mimeType` | String | |
| `sizeBytes` | Int | |
| `storageKey` | String | đường dẫn trong object storage (S3/MinIO/local) |
| `checksum` | String? | dedupe |
| `createdAt` | DateTime | |
- `@@index([issueId])`, `@@index([commentId])`.
- **Hard-delete** kèm xóa file vật lý (qua hook ở service).

---

## 12. Notification, Activity Log, Presence

### 12.1. `Notification`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `recipientId` | String | FK User Cascade |
| `workspaceId` | String | FK Cascade |
| `type` | `NotificationType` enum | ISSUE_ASSIGNED / ISSUE_UPDATED / MENTIONED / COMMENT_ADDED / STATUS_CHANGED / SPRINT_STARTED / SPRINT_COMPLETED ... |
| `issueId` | String? | FK Issue Cascade |
| `commentId` | String? | FK Comment Cascade |
| `actorId` | String? | FK User SetNull — người gây ra sự kiện |
| `payload` | Json | dữ liệu render notification |
| `readAt` | DateTime? | null = chưa đọc |
| `createdAt` | DateTime | |
- `@@index([recipientId, readAt])`, `@@index([recipientId, createdAt])`.
- **Hard-delete** theo retention (vd 90 ngày).

> **Điểm giao tiếp (Realtime):** sau khi insert `Notification`, backend emit Socket.io event `notification:new` tới room của `recipientId`. Unread count = `count(readAt IS NULL)`.

### 12.2. `ActivityLog` (audit trail toàn cục)
Ghi mọi thay đổi quan trọng. Là nguồn cho "Activity" tab của issue, CFD reports, audit.

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `workspaceId` | String | FK Cascade |
| `projectId` | String? | FK Cascade |
| `issueId` | String? | FK Cascade |
| `actorId` | String? | FK User SetNull |
| `action` | `ActivityAction` enum | ISSUE_CREATED / ISSUE_UPDATED / STATUS_CHANGED / ASSIGNEE_CHANGED / COMMENT_ADDED / SPRINT_CHANGED / FIELD_CHANGED ... |
| `entityType` | String | "Issue" / "Sprint" / "Comment" ... |
| `entityId` | String | |
| `field` | String? | tên field thay đổi (cho FIELD_CHANGED) |
| `oldValue` | Json? | |
| `newValue` | Json? | |
| `createdAt` | DateTime | |
- `@@index([issueId, createdAt])`, `@@index([workspaceId, createdAt])`, `@@index([projectId, action, createdAt])`.
- Append-only; không update. Purge theo retention (ENTERPRISE giữ lâu hơn).

> **Quyết định:** ActivityLog lưu `oldValue`/`newValue` dạng `Json` để generic. Status-change activity (`action = STATUS_CHANGED`) là nguồn chính xác nhất cho **Cumulative Flow Diagram** — Reports tính số issue ở mỗi status theo thời gian từ chuỗi log này (event sourcing nhẹ).

### 12.3. Presence (Realtime) — không cần bảng riêng
- Presence (ai đang xem issue/board) là **ephemeral**, lưu ở **Redis/in-memory của Socket.io**, KHÔNG ở PostgreSQL. Chỉ `User.lastSeenAt` được persist (cập nhật throttled).
- Quyết định này tránh ghi DB nóng và phù hợp realtime subsystem.

---

## 13. Dashboard & Widget

### 13.1. `Dashboard`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `workspaceId` | String | FK Cascade |
| `ownerId` | String | FK User |
| `name` | String | |
| `layout` | Json | `@default("{}")` — grid layout (react-grid-layout) |
| `visibility` | `DashboardVisibility` enum | PRIVATE / WORKSPACE |
| `deletedAt` | DateTime? | soft-delete |
| audit | | |
- `@@index([workspaceId, ownerId])`.

### 13.2. `DashboardWidget`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `dashboardId` | String | FK Cascade |
| `type` | `WidgetType` enum | BURNDOWN / VELOCITY / CFD / PIE_BY_STATUS / ASSIGNEE_WORKLOAD / FILTER_RESULTS / CREATED_VS_RESOLVED / CUSTOM |
| `title` | String? | |
| `config` | Json | `@default("{}")` — vd `{ projectId, sprintId, filterId, groupBy }` |
| `gridX`, `gridY`, `gridW`, `gridH` | Int | vị trí/kích thước |
| `order` | Int | |
- `@@index([dashboardId])`.

> **Điểm giao tiếp (Analytics subsystem):** widget chỉ lưu `config` (tham chiếu filter/project/sprint). Dữ liệu chart được Analytics subsystem tính runtime từ `Issue`/`SprintReportSnapshot`/`ActivityLog`. Export PDF/Excel đọc cùng nguồn. Data model không cache kết quả chart (tránh stale); nếu cần, thêm bảng `ReportCache` sau.

---

## 14. Auth tokens

### 14.1. `RefreshToken`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | String | PK |
| `userId` | String | FK User Cascade |
| `tokenHash` | String | `@unique` — hash của refresh token (không lưu plaintext) |
| `family` | String | rotation family (chống replay) |
| `expiresAt` | DateTime | |
| `revokedAt` | DateTime? | |
| `userAgent` | String? | |
| `ipAddress` | String? | |
| `createdAt` | DateTime | |
- `@@index([userId])`, `@@index([tokenHash])`.

> Access token (JWT) **không** lưu DB (stateless). Chỉ refresh token persist để revoke/rotate. Điểm giao tiếp với Auth subsystem.

---

## 15. Danh mục Enum (Prisma)

```prisma
enum UserStatus            { ACTIVE DEACTIVATED INVITED }
enum WorkspacePlan         { FREE PRO ENTERPRISE }
enum RoleScope             { WORKSPACE PROJECT }
enum PermissionScope       { WORKSPACE PROJECT }
enum PermissionKey {
  WORKSPACE_ADMIN MEMBER_MANAGE
  PROJECT_ADMIN PROJECT_CREATE PROJECT_DELETE
  ISSUE_CREATE ISSUE_EDIT ISSUE_DELETE ISSUE_ASSIGN ISSUE_TRANSITION
  COMMENT_CREATE COMMENT_DELETE
  BOARD_MANAGE SPRINT_MANAGE WORKFLOW_EDIT
  CUSTOMFIELD_MANAGE FILTER_SHARE DASHBOARD_MANAGE
}
enum ProjectType           { SCRUM KANBAN }
enum DefaultAssigneeMode   { UNASSIGNED PROJECT_LEAD }
enum BoardType             { KANBAN SCRUM }
enum StatusCategory        { TODO IN_PROGRESS DONE }
enum SprintState           { FUTURE ACTIVE CLOSED }
enum SnapshotKind          { START DAILY SCOPE_CHANGE CLOSE }
enum IssueTypeKey          { EPIC STORY TASK BUG SUBTASK }
enum IssuePriority         { HIGHEST HIGH MEDIUM LOW LOWEST }
enum IssueResolution       { DONE WONT_DO DUPLICATE CANNOT_REPRODUCE INCOMPLETE }
enum IssueLinkType         { BLOCKS IS_BLOCKED_BY RELATES_TO DUPLICATES IS_DUPLICATED_BY CLONES }
enum FixVersionType        { FIX AFFECTS }
enum VersionStatus         { UNRELEASED RELEASED ARCHIVED }
enum RichTextFormat        { MARKDOWN TIPTAP_JSON }
enum CustomFieldType       { TEXT TEXTAREA NUMBER DATE DATETIME SELECT MULTI_SELECT CHECKBOX USER URL }
enum FilterVisibility      { PRIVATE WORKSPACE PROJECT }
enum DashboardVisibility   { PRIVATE WORKSPACE }
enum WidgetType            { BURNDOWN VELOCITY CFD PIE_BY_STATUS ASSIGNEE_WORKLOAD FILTER_RESULTS CREATED_VS_RESOLVED CUSTOM }
enum NotificationType      { ISSUE_ASSIGNED ISSUE_UPDATED MENTIONED COMMENT_ADDED STATUS_CHANGED SPRINT_STARTED SPRINT_COMPLETED WATCHING_UPDATE }
enum ActivityAction        { ISSUE_CREATED ISSUE_UPDATED ISSUE_DELETED STATUS_CHANGED ASSIGNEE_CHANGED PRIORITY_CHANGED FIELD_CHANGED COMMENT_ADDED COMMENT_DELETED SPRINT_CHANGED SPRINT_STARTED SPRINT_COMPLETED PROJECT_KEY_CHANGED ATTACHMENT_ADDED LINK_ADDED }
enum AiSuggestionKind      { ASSIGNEE PRIORITY STORY_POINTS SUMMARY DESCRIPTION SPRINT_PLAN }
enum AiSuggestionStatus    { PENDING ACCEPTED REJECTED EXPIRED }
enum EmbeddingEntityType   { ISSUE COMMENT }
```

---

## 16. Prisma schema — trích đoạn cốt lõi (sẵn sàng implement)

> File: `apps/api/prisma/schema.prisma`. Dưới đây là phần datasource/generator + các model trung tâm. Các model còn lại theo đúng bảng đặc tả ở trên.

```prisma
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgvector(map: "vector"), pg_trgm]   // preview: postgresqlExtensions
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions", "fullTextSearchPostgres"]
}

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String?
  displayName   String
  avatarUrl     String?
  timezone      String   @default("UTC")
  locale        String   @default("en")
  status        UserStatus @default(ACTIVE)
  lastSeenAt    DateTime?
  isSystemAdmin Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workspaceMemberships WorkspaceMembership[]
  projectMemberships   ProjectMembership[]
  reportedIssues       Issue[]  @relation("IssueReporter")
  assignedIssues       Issue[]  @relation("IssueAssignee")
  comments             Comment[]
  refreshTokens        RefreshToken[]
  notifications        Notification[] @relation("NotificationRecipient")

  @@index([status])
}

model Project {
  id                String   @id @default(cuid())
  workspaceId       String
  key               String
  name              String
  description       String?
  type              ProjectType @default(SCRUM)
  leadId            String?
  avatarUrl         String?
  issueSequence     Int      @default(0)
  defaultWorkflowId String?
  defaultAssigneeMode DefaultAssigneeMode @default(UNASSIGNED)
  isArchived        Boolean  @default(false)
  settings          Json     @default("{}")
  deletedAt         DateTime?
  createdById       String?
  updatedById       String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  lead      User?     @relation("ProjectLead", fields: [leadId], references: [id], onDelete: SetNull)
  issues    Issue[]
  boards    Board[]
  sprints   Sprint[]
  workflows Workflow[]
  labels    Label[]
  components Component[]
  versions  Version[]

  @@unique([workspaceId, key])
  @@unique([workspaceId, name])
  @@index([workspaceId])
  @@index([leadId])
  @@index([deletedAt])
}

model Issue {
  id                String   @id @default(cuid())
  workspaceId       String
  projectId         String
  number            Int
  key               String
  typeId            String
  statusId          String
  priority          IssuePriority @default(MEDIUM)
  summary           String   @db.VarChar(255)
  description       String?  @db.Text
  descriptionFormat RichTextFormat @default(MARKDOWN)
  reporterId        String?
  assigneeId        String?
  parentId          String?
  epicId            String?
  sprintId          String?
  storyPoints       Float?
  originalEstimate  Int?
  remainingEstimate Int?
  timeSpent         Int?
  dueDate           DateTime?
  startDate         DateTime?
  resolution        IssueResolution?
  resolvedAt        DateTime?
  rank              String
  searchVector      Unsupported("tsvector")?
  embedding         Unsupported("vector(384)")?
  deletedAt         DateTime?
  createdById       String?
  updatedById       String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  workspace  Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  project    Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  type       IssueType  @relation(fields: [typeId], references: [id])
  status     Status     @relation(fields: [statusId], references: [id])
  reporter   User?      @relation("IssueReporter", fields: [reporterId], references: [id], onDelete: SetNull)
  assignee   User?      @relation("IssueAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  parent     Issue?     @relation("IssueParent", fields: [parentId], references: [id], onDelete: SetNull)
  children   Issue[]    @relation("IssueParent")
  epic       Issue?     @relation("IssueEpic", fields: [epicId], references: [id], onDelete: SetNull)
  epicChildren Issue[]  @relation("IssueEpic")
  sprint     Sprint?    @relation(fields: [sprintId], references: [id], onDelete: SetNull)
  comments   Comment[]
  attachments Attachment[]
  labels     IssueLabel[]
  components IssueComponent[]
  fixVersions IssueFixVersion[]
  customFieldValues CustomFieldValue[]
  watchers   IssueWatcher[]
  workLogs   WorkLog[]
  sourceLinks IssueLink[] @relation("IssueLinkSource")
  targetLinks IssueLink[] @relation("IssueLinkTarget")

  @@unique([projectId, number])
  @@unique([workspaceId, key])
  @@index([projectId, statusId])
  @@index([sprintId])
  @@index([assigneeId])
  @@index([parentId])
  @@index([epicId])
  @@index([typeId])
  @@index([projectId, deletedAt])
  @@index([rank])
}
```

> Các index `hnsw` (vector) và `gin` (tsvector, trgm) tạo bằng raw SQL migration (mục 8) vì Prisma chưa hỗ trợ trực tiếp.

---

## 17. Seed data (yêu cầu `pnpm dev`/`docker compose up` chạy được)

File `apps/api/prisma/seed.ts` phải tạo:
1. **Permission catalog** (toàn bộ `PermissionKey`).
2. **System roles**: `Workspace Admin`, `Member`, `Viewer` (workspace scope); `Project Admin`, `Developer`, `Reporter` (project scope) + gán permission.
3. **Demo users** (vd `admin@projira.dev`, password hash bcrypt sẵn).
4. **1 Workspace** demo + membership.
5. **2 Project** (1 SCRUM `PROJ`, 1 KANBAN `WEB`) kèm: default Workflow (To Do/In Progress/In Review/Done + transitions), IssueTypes (Epic/Story/Task/Bug/Sub-task), Board + columns map status, Labels/Components.
6. **Sprints** (1 CLOSED có snapshot để demo velocity, 1 ACTIVE, 1 FUTURE).
7. **~30–50 Issues** đa dạng type/status/assignee/story points, vài comment + @mention, attachment giả, custom field, issue links, để Board/Backlog/Reports có dữ liệu.
8. **1 SprintReportSnapshot** chuỗi cho sprint CLOSED (demo burndown).
9. **1 Dashboard** với vài widget.
10. Nếu `EMBEDDING_PROVIDER` bật → seed embedding cho issues; nếu không → bỏ qua (degrade).

---

## 18. Migration & vận hành

1. **Thứ tự migration:** (a) enable extensions (`vector`, `pg_trgm`) → (b) tạo bảng (Prisma migrate) → (c) raw SQL thêm generated column `searchVector` + index `gin`/`hnsw`.
2. **Generated column** `searchVector` không khai báo qua Prisma model field bình thường → dùng `Unsupported` + raw migration. Khi `prisma db pull`, giữ nguyên (đừng để Prisma drop).
3. **`docker-compose.yml`** dùng image `pgvector/pgvector:pg16` (đã có sẵn extension `vector`); `pg_trgm` là built-in contrib.
4. **Index lưu ý:** `hnsw` cần `vector` ≥ 0.5; với dataset nhỏ (demo) `ivfflat`/`hnsw` đều ổn. HNSW không cần training, chọn HNSW.
5. **Backfill embedding/searchVector:** job nền của AI subsystem; `searchVector` tự backfill (generated STORED). `embedding` backfill async, idempotent qua `contentHash`.

---

## 19. Tóm tắt điểm giao tiếp với subsystem khác

| Subsystem | Tiêu thụ gì từ Data Model | Trách nhiệm của họ |
|---|---|---|
| **API / RBAC** | Mọi model; `Permission/Role/Membership` cho guard; soft-delete extension | Resolve quyền, parse JQL → `where`, cấp phát issue key trong transaction |
| **Realtime (Socket.io)** | `Issue`, `Notification`, `Comment`, `User.lastSeenAt` | Emit event khi DB thay đổi; presence ở Redis (không persist); optimistic UI dùng `id` cuid sinh client + `rank` LexoRank |
| **AI (Claude)** | `Issue`, `Comment` (input); ghi `AiSuggestion`, `AiGenerationLog`, cột `embedding` | Gọi `claude-opus-4-8`/`claude-sonnet-4-6`; **sinh embedding bằng provider riêng (KHÔNG phải Claude)**; degrade khi thiếu API key |
| **Search** | `searchVector` (tsvector), `embedding` (pgvector), `SavedFilter` | Parser JQL, kết hợp full-text + semantic, fallback khi không có embedding |
| **Reports / Analytics** | `SprintReportSnapshot`, `ActivityLog` (status-change), `Issue`, `StatusCategory` | Burndown/velocity/CFD tính từ snapshot + log; export PDF/Excel; cron ghi snapshot DAILY |
| **Frontend** | Toàn bộ qua API; quy ước `RichTextFormat`, `layout` JSON cho dashboard | Render; gửi `id` cuid cho optimistic create |

**Hai lưu ý kiến trúc quan trọng nhất cần các subsystem nắm:**
1. **Anthropic Claude không có embedding API** → semantic search dùng pgvector + embedding provider tách biệt (mặc định MiniLM local, degrade về full-text).
2. **Issue key cấp phát bằng atomic increment `Project.issueSequence` trong transaction**, key denormalized & immutable; mọi ordering dùng **LexoRank** để drag-drop chỉ update 1 row.