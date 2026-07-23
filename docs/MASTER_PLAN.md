I have full context. Note the existing scaffold uses Postgres image `postgres:16-alpine` but pgvector is needed — I'll flag switching to `pgvector/pgvector:pg16`. Writing the master plan.

# Tirapro — MASTER PLAN Kiến trúc Tích hợp

> **Vai trò tài liệu:** Single source of truth cấp dự án. Lead Architect đã đọc 9 bản đặc tả subsystem, reconcile mâu thuẫn, và chốt các quyết định ràng buộc. Mọi subsystem implement theo tài liệu này. Phần xung đột giữa các spec đã được giải quyết và ghi rõ ở mục "Quyết định reconcile".

---

## 0. Các quyết định reconcile (giải quyết mâu thuẫn giữa 9 spec)

| Vấn đề | Các spec mâu thuẫn | **Quyết định chốt** |
|---|---|---|
| Kiểu ID | data-model: CUID · api-contract: cuid · backend-arch/frontend: "UUID/CUID" | **CUID** (`@default(cuid())`) toàn hệ thống. Frontend sinh cuid client-side cho optimistic create. |
| Tenant entity | data-model/backend/realtime: `Workspace` · api-contract: `/orgs` · realtime: `orgId` | Entity DB = **`Workspace`**. REST path dùng **`/workspaces`** (KHÔNG `/orgs`). JWT claim = `workspaceId`. Realtime room `ws:{workspaceId}`. |
| Vị trí Prisma schema | backend-arch: `packages/db` · devops: `apps/api/prisma` | **`apps/api/prisma`** (đã scaffold sẵn). Prisma Client export lại qua `@tirapro/db` chỉ khi cần dùng ở seed/script; mặc định api import trực tiếp. |
| Tiêu đề issue | data-model/design: `summary` · api/frontend: `title` | DB field = **`summary`** (chuẩn Jira). DTO/API expose alias `summary`. Frontend dùng `summary`. |
| OCC version | realtime cần `version Int` · data-model không có | **Thêm `version Int @default(1)`** vào `Issue` và `Comment`. |
| Embedding dimension | data-model: 384 (MiniLM) · ai-features: 1024 (Voyage)/1536 (OpenAI) | **`vector(1024)`** mặc định (Voyage `voyage-3`). Cấu hình qua `EMBEDDING_DIM`. Đổi dim ⇒ migration + reindex. Anthropic **KHÔNG có embedding API** (chốt cứng). |
| Embedding storage | data-model: `Issue.embedding` inline + bảng `EmbeddingDocument` · ai-features: bảng `IssueEmbedding` riêng | **Bảng riêng `IssueEmbedding`** (tách khỏi hot table `Issue`, dễ reindex). Không nhúng vector vào `Issue`. |
| Theme lib | frontend: next-themes/Zustand · design: next-themes/Zustand | **Zustand store tự quản** + anti-FOUC inline script (design-system §4.2). |
| API port | backend: 4000 · devops `.env`: API_PORT=4000 · frontend `.env`: 3000 | **API = 4000**, Web = 5173. Frontend `VITE_API_URL=http://localhost:4000/api/v1`. |
| Postgres image | devops scaffold: `postgres:16-alpine` · data-model/ai: `pgvector/pgvector:pg16` | **`pgvector/pgvector:pg16`** (cần extension `vector`). Phải sửa `docker-compose.yml` đã scaffold. |
| Permission key format | api-contract: `resource:action` · data-model: enum `ISSUE_CREATE` | **String `resource:action`** ở API/guard layer (CASL). Bảng `Permission.key` lưu cùng format string. Bỏ enum cứng. |
| AI persist | ai-features: AiModule KHÔNG ghi issue, chỉ preview | **Chốt**: AI trả preview/suggestion; Issues subsystem persist. |

---

## 1. Tổng quan kiến trúc (high-level)

```
                                   Browser (PWA, React 18 + Vite)
        ┌───────────────────────────────────────────────────────────────────┐
        │  React Router · TanStack Query (server state) · Zustand (UI state)  │
        │  shadcn/ui · Tailwind · dnd-kit · recharts · cmdk · Tiptap          │
        └───────┬───────────────────────────────────────┬────────────────────┘
                │ REST /api/v1 (axios + JWT)             │ WS /realtime (socket.io-client)
                │ (TanStack Query)                       │ (auth: Bearer in handshake)
                ▼                                        ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │                      NestJS 10 API  (apps/api, :4000)                  │
        │  Guards: JwtAuth → WorkspaceScope → Permissions(CASL)                  │
        │  Interceptors: RequestId · Logging(pino) · ResponseEnvelope · Timeout  │
        │  Filters: PrismaException → AllExceptions                              │
        │                                                                        │
        │  Feature modules: auth users workspaces projects members rbac          │
        │   issues custom-fields workflows boards sprints backlog comments       │
        │   attachments search reports dashboards notifications activity         │
        │   ai realtime health                                                   │
        │                                                                        │
        │  EventEmitter2 (domain events) ──► RealtimeBridge ──► Socket.io Gateway │
        │  BullMQ producers ──► queues (notifications, ai, reports, search-index)│
        └───┬─────────────────┬──────────────────┬───────────────┬──────────────┘
            │ Prisma          │ ioredis          │ @anthropic-ai  │ Voyage/OpenAI
            ▼                 ▼                  ▼ /sdk           ▼ (embeddings REST)
   ┌──────────────┐  ┌───────────────┐   ┌──────────────┐  ┌──────────────────┐
   │ PostgreSQL   │  │ Redis 7       │   │ Claude API   │  │ Embedding provider│
   │ + pgvector   │  │ - socket.io   │   │ opus-4-8     │  │ (degrade→FTS)     │
   │ + pg_trgm    │  │   adapter     │   │ sonnet-4-6   │  │ KHÔNG phải Claude │
   │ + tsvector   │  │ - BullMQ      │   │ (degrade→    │  └──────────────────┘
   │              │  │ - presence    │   │  heuristic)  │
   │              │  │ - cache/throttle│ └──────────────┘
   └──────────────┘  └───────────────┘

   Degrade gracefully: thiếu ANTHROPIC_API_KEY → AI heuristic/disabled (app vẫn chạy)
                       Redis/realtime down → REST vẫn hoạt động (enhancement, không block)
                       thiếu embedding key → semantic search → full-text fallback
```

**Triết lý xuyên suốt:** Modular monolith · contract-first (`@tirapro/types` + `@tirapro/shared` dùng chung FE↔BE) · optimistic UI + LexoRank ordering + OCC version · degrade gracefully cho mọi tính năng "nâng cấp" (AI, realtime, semantic).

---

## 2. Cấu trúc thư mục monorepo

```
tirapro/                              # repo root — pnpm workspaces + Turborepo
├── apps/
│   ├── api/                          # NestJS 10 (:4000) — SỞ HỮU prisma schema
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # ← mục 3 (single source of truth data model)
│   │   │   ├── migrations/
│   │   │   │   ├── 0000_init/
│   │   │   │   └── 0001_pgvector_fts/migration.sql   # raw: extensions+vector+tsvector
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/               # decorators guards filters interceptors pipes dto utils constants
│   │   │   ├── config/               # configuration.ts env.validation.ts config.module.ts
│   │   │   ├── infra/                # prisma redis queue storage mailer
│   │   │   └── modules/              # 1 folder/feature (controller service repository dto events)
│   │   │       ├── auth/ users/ workspaces/ projects/ members/ rbac/
│   │   │       ├── issues/ custom-fields/ workflows/ boards/ sprints/ backlog/
│   │   │       ├── comments/ attachments/ search/ reports/ dashboards/
│   │   │       ├── notifications/ activity/ ai/ realtime/ health/
│   │   ├── test/                     # e2e
│   │   ├── package.json  tsconfig.json  .eslintrc.cjs  nest-cli.json
│   │
│   └── web/                          # React 18 + Vite (:5173)
│       ├── public/ (icons, manifest)
│       ├── index.html                # anti-FOUC theme script
│       ├── src/
│       │   ├── main.tsx  App.tsx
│       │   ├── app/                  # providers router config
│       │   ├── components/           # ui(shadcn) layout feedback data-display form command
│       │   ├── features/             # auth projects board backlog sprints issues comments
│       │   │                         # attachments search reports dashboard workflows
│       │   │                         # notifications ai command-palette presence settings admin
│       │   ├── lib/                  # api(axios,queryClient,queryKeys) socket utils pwa
│       │   ├── hooks/ stores/ types/ styles/
│       ├── vite.config.ts  tailwind.config.ts  tsconfig.json  .eslintrc.cjs
│
├── packages/
│   ├── types/                        # @tirapro/types — enums + interfaces (zero-dep, MASTER enum)
│   ├── shared/                       # @tirapro/shared — Zod schemas, WS event types, JQL grammar, utils
│   ├── eslint-config/                # @tirapro/eslint-config (index/nest/react)
│   └── tsconfig/                     # @tirapro/tsconfig (base/nestjs/vite/library)
│
├── docker/postgres/initdb/01-extensions.sql   # vector, pg_trgm, btree_gin
├── .github/workflows/ci.yml
├── docker-compose.yml                # pgvector/pgvector:pg16 + redis:7 + adminer(profile tools)
├── turbo.json  pnpm-workspace.yaml  package.json
├── tsconfig.json (solution refs)  tsconfig.base.json
├── .env.example  .env(gitignored)  .nvmrc(22)  .npmrc
├── .prettierrc.json  .lintstagedrc.json  commitlint.config.cjs
├── .husky/{pre-commit,commit-msg}
└── README.md
```

---

## 3. PRISMA SCHEMA HOÀN CHỈNH

> File: `apps/api/prisma/schema.prisma`. Sẵn sàng `prisma migrate`. Các index `hnsw`/`gin`/generated `tsvector` tạo bằng raw SQL migration (`0001_pgvector_fts/migration.sql`) — ghi chú inline. Đã hợp nhất toàn bộ entity từ 9 spec, thêm `version` (OCC), `IssueEmbedding`, snapshot/cache reports.

```prisma
// ============================================================================
// Tirapro — Prisma schema (PostgreSQL). Single source of truth cho data model.
// ============================================================================
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgvector(map: "vector"), pgTrgm(map: "pg_trgm")]
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions", "fullTextSearchPostgres"]
}

// ============================ ENUMS =========================================
enum UserStatus           { ACTIVE DEACTIVATED INVITED }
enum WorkspacePlan        { FREE PRO ENTERPRISE }
enum RoleScope            { WORKSPACE PROJECT }
enum PermissionScope      { WORKSPACE PROJECT }
enum ProjectType          { SCRUM KANBAN }
enum DefaultAssigneeMode  { UNASSIGNED PROJECT_LEAD }
enum BoardType            { KANBAN SCRUM }
enum StatusCategory       { TODO IN_PROGRESS DONE }
enum SprintState          { FUTURE ACTIVE CLOSED }
enum SnapshotKind         { START DAILY SCOPE_CHANGE CLOSE }
enum IssueTypeKey         { EPIC STORY TASK BUG SUBTASK }
enum IssuePriority        { HIGHEST HIGH MEDIUM LOW LOWEST }
enum IssueResolution      { DONE WONT_DO DUPLICATE CANNOT_REPRODUCE INCOMPLETE }
enum IssueLinkType        { BLOCKS IS_BLOCKED_BY RELATES_TO DUPLICATES IS_DUPLICATED_BY CLONES }
enum FixVersionType       { FIX AFFECTS }
enum VersionStatus        { UNRELEASED RELEASED ARCHIVED }
enum RichTextFormat       { MARKDOWN TIPTAP_JSON }
enum CustomFieldType      { TEXT TEXTAREA NUMBER DATE DATETIME SELECT MULTI_SELECT CHECKBOX USER URL }
enum FilterVisibility     { PRIVATE WORKSPACE PROJECT }
enum DashboardScope       { PRIVATE PROJECT GLOBAL }
enum WidgetType           { BURNDOWN VELOCITY CFD SPRINT_REPORT CONTROL_CHART CREATED_VS_RESOLVED STAT_NUMBER ISSUE_LIST PIE_BY_FIELD AI_INSIGHT }
enum NotificationType     { ISSUE_ASSIGNED ISSUE_UPDATED MENTIONED COMMENT_ADDED STATUS_CHANGED SPRINT_STARTED SPRINT_COMPLETED WATCHING_UPDATE }
enum ActivityAction       { ISSUE_CREATED ISSUE_UPDATED ISSUE_DELETED STATUS_CHANGED ASSIGNEE_CHANGED PRIORITY_CHANGED FIELD_CHANGED COMMENT_ADDED COMMENT_DELETED SPRINT_CHANGED SPRINT_STARTED SPRINT_COMPLETED PROJECT_KEY_CHANGED ATTACHMENT_ADDED LINK_ADDED }
enum HistoryField         { STATUS STORY_POINTS SPRINT ASSIGNEE TYPE RESOLUTION SCOPE PRIORITY }
enum AiSuggestionKind     { ASSIGNEE PRIORITY STORY_POINTS SUMMARY DESCRIPTION SPRINT_PLAN }
enum AiSuggestionStatus   { PENDING ACCEPTED REJECTED EXPIRED }
enum EmbeddingEntityType  { ISSUE COMMENT }

// ============================ IDENTITY / TENANCY / RBAC =====================
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
  ownedWorkspaces      Workspace[]           @relation("WorkspaceOwner")
  ledProjects          Project[]             @relation("ProjectLead")
  reportedIssues       Issue[]               @relation("IssueReporter")
  assignedIssues       Issue[]               @relation("IssueAssignee")
  comments             Comment[]
  refreshTokens        RefreshToken[]
  notifications        Notification[]        @relation("NotificationRecipient")
  watching             IssueWatcher[]
  workLogs             WorkLog[]
  savedFilters         SavedFilter[]
  dashboards           Dashboard[]

  @@index([status])
}

model Workspace {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  ownerId     String
  plan        WorkspacePlan @default(FREE)
  settings    Json     @default("{}")
  deletedAt   DateTime?
  createdById String?
  updatedById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner        User                  @relation("WorkspaceOwner", fields: [ownerId], references: [id])
  memberships  WorkspaceMembership[]
  roles        Role[]
  projects     Project[]
  issueTypes   IssueType[]
  issues       Issue[]
  customFields CustomField[]
  savedFilters SavedFilter[]
  dashboards   Dashboard[]
  notifications Notification[]
  activities   ActivityLog[]

  @@index([slug])
  @@index([deletedAt])
}

model Permission {
  id          String   @id @default(cuid())
  key         String   @unique              // format "resource:action" vd "issue:create"
  description String
  scope       PermissionScope
  roles       RolePermission[]
}

model Role {
  id          String   @id @default(cuid())
  workspaceId String?                        // null = system role dùng chung
  name        String
  scope       RoleScope
  isSystem    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace            Workspace?            @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  permissions          RolePermission[]
  workspaceMemberships WorkspaceMembership[]
  projectMemberships   ProjectMembership[]

  @@unique([workspaceId, name, scope])
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  @@id([roleId, permissionId])
}

model WorkspaceMembership {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String
  roleId      String
  invitedById String?
  joinedAt    DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      Role      @relation(fields: [roleId], references: [id])

  @@unique([workspaceId, userId])
  @@index([userId])
}

model ProjectMembership {
  id        String   @id @default(cuid())
  projectId String
  userId    String
  roleId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  role    Role    @relation(fields: [roleId], references: [id])

  @@unique([projectId, userId])
  @@index([userId])
  @@index([projectId])
}

// ============================ PROJECT & CONFIG ==============================
model Project {
  id                  String   @id @default(cuid())
  workspaceId         String
  key                 String                       // 2-10 [A-Z][A-Z0-9]*
  name                String
  description         String?
  type                ProjectType @default(SCRUM)
  leadId              String?
  avatarUrl           String?
  issueSequence       Int      @default(0)         // atomic counter cho issue key
  defaultWorkflowId   String?
  defaultAssigneeMode DefaultAssigneeMode @default(UNASSIGNED)
  isArchived          Boolean  @default(false)
  settings            Json     @default("{}")      // workingDays, holidays...
  deletedAt           DateTime?
  createdById         String?
  updatedById         String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  workspace   Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  lead        User?       @relation("ProjectLead", fields: [leadId], references: [id], onDelete: SetNull)
  memberships ProjectMembership[]
  issues      Issue[]
  boards      Board[]
  sprints     Sprint[]
  workflows   Workflow[]
  labels      Label[]
  components  Component[]
  versions    Version[]
  customFields CustomField[]
  savedFilters SavedFilter[]
  dashboards  Dashboard[]
  activities  ActivityLog[]

  @@unique([workspaceId, key])
  @@unique([workspaceId, name])
  @@index([workspaceId])
  @@index([leadId])
  @@index([deletedAt])
}

model Label {
  id        String  @id @default(cuid())
  projectId String
  name      String
  color     String?
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  issues    IssueLabel[]
  @@unique([projectId, name])
}

model Component {
  id          String  @id @default(cuid())
  projectId   String
  name        String
  description String?
  leadId      String?
  project     Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  issues      IssueComponent[]
  @@unique([projectId, name])
}

model Version {
  id          String   @id @default(cuid())
  projectId   String
  name        String
  description String?
  status      VersionStatus @default(UNRELEASED)
  startDate   DateTime?
  releaseDate DateTime?
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  issues      IssueFixVersion[]
  @@unique([projectId, name])
}

// ============================ WORKFLOW ======================================
model Workflow {
  id          String   @id @default(cuid())
  projectId   String
  name        String
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  statuses    Status[]
  transitions WorkflowTransition[]

  @@unique([projectId, name])
}

model Status {
  id         String   @id @default(cuid())
  workflowId String
  name       String
  category   StatusCategory
  color      String?
  order      Int      @default(0)
  isInitial  Boolean  @default(false)

  workflow         Workflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  issues           Issue[]
  fromTransitions  WorkflowTransition[] @relation("TransitionFrom")
  toTransitions    WorkflowTransition[] @relation("TransitionTo")
  boardColumns     BoardColumnStatus[]

  @@unique([workflowId, name])
  @@index([workflowId])
}

model WorkflowTransition {
  id           String   @id @default(cuid())
  workflowId   String
  name         String
  fromStatusId String?                    // null = từ-mọi-trạng-thái
  toStatusId   String
  order        Int      @default(0)

  workflow   Workflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  fromStatus Status?  @relation("TransitionFrom", fields: [fromStatusId], references: [id], onDelete: Cascade)
  toStatus   Status   @relation("TransitionTo", fields: [toStatusId], references: [id], onDelete: Cascade)

  @@index([workflowId])
  @@index([fromStatusId])
  @@index([toStatusId])
}

// ============================ ISSUE =========================================
model IssueType {
  id             String  @id @default(cuid())
  workspaceId    String
  name           String
  key            IssueTypeKey?
  iconUrl        String?
  color          String?
  hierarchyLevel Int     @default(0)        // Epic=1, standard=0, Sub-task=-1
  isSubtask      Boolean @default(false)
  isSystem       Boolean @default(false)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  issues    Issue[]

  @@unique([workspaceId, name])
  @@index([workspaceId])
}

model Issue {
  id                String   @id @default(cuid())
  workspaceId       String
  projectId         String
  number            Int
  key               String                          // denormalized "PROJ-123"
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
  rank              String                          // LexoRank
  version           Int      @default(1)            // OCC cho realtime/optimistic
  searchVector      Unsupported("tsvector")?        // generated (raw migration)
  deletedAt         DateTime?
  createdById       String?
  updatedById       String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  project      Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  type         IssueType @relation(fields: [typeId], references: [id])
  status       Status    @relation(fields: [statusId], references: [id])
  reporter     User?     @relation("IssueReporter", fields: [reporterId], references: [id], onDelete: SetNull)
  assignee     User?     @relation("IssueAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  parent       Issue?    @relation("IssueParent", fields: [parentId], references: [id], onDelete: SetNull)
  children     Issue[]   @relation("IssueParent")
  epic         Issue?    @relation("IssueEpic", fields: [epicId], references: [id], onDelete: SetNull)
  epicChildren Issue[]   @relation("IssueEpic")
  sprint       Sprint?   @relation(fields: [sprintId], references: [id], onDelete: SetNull)

  comments          Comment[]
  attachments       Attachment[]
  labels            IssueLabel[]
  components        IssueComponent[]
  fixVersions       IssueFixVersion[]
  customFieldValues CustomFieldValue[]
  watchers          IssueWatcher[]
  workLogs          WorkLog[]
  sourceLinks       IssueLink[] @relation("IssueLinkSource")
  targetLinks       IssueLink[] @relation("IssueLinkTarget")
  mentions          Mention[]
  history           IssueHistory[]
  embedding         IssueEmbedding?
  aiSuggestions     AiSuggestion[]
  notifications     Notification[]
  activities        ActivityLog[]

  @@unique([projectId, number])
  @@unique([workspaceId, key])
  @@index([projectId, statusId])
  @@index([sprintId])
  @@index([assigneeId])
  @@index([reporterId])
  @@index([parentId])
  @@index([epicId])
  @@index([typeId])
  @@index([projectId, deletedAt])
  @@index([rank])
  // GIN index trên searchVector: tạo bằng raw SQL migration
}

model IssueLabel {
  issueId String
  labelId String
  issue   Issue @relation(fields: [issueId], references: [id], onDelete: Cascade)
  label   Label @relation(fields: [labelId], references: [id], onDelete: Cascade)
  @@id([issueId, labelId])
  @@index([labelId])
}

model IssueComponent {
  issueId     String
  componentId String
  issue       Issue     @relation(fields: [issueId], references: [id], onDelete: Cascade)
  component   Component @relation(fields: [componentId], references: [id], onDelete: Cascade)
  @@id([issueId, componentId])
}

model IssueFixVersion {
  issueId   String
  versionId String
  type      FixVersionType
  issue     Issue   @relation(fields: [issueId], references: [id], onDelete: Cascade)
  version   Version @relation(fields: [versionId], references: [id], onDelete: Cascade)
  @@id([issueId, versionId, type])
}

model IssueLink {
  id            String   @id @default(cuid())
  sourceIssueId String
  targetIssueId String
  type          IssueLinkType
  source        Issue    @relation("IssueLinkSource", fields: [sourceIssueId], references: [id], onDelete: Cascade)
  target        Issue    @relation("IssueLinkTarget", fields: [targetIssueId], references: [id], onDelete: Cascade)
  @@unique([sourceIssueId, targetIssueId, type])
  @@index([targetIssueId])
}

model IssueWatcher {
  issueId String
  userId  String
  issue   Issue @relation(fields: [issueId], references: [id], onDelete: Cascade)
  user    User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([issueId, userId])
  @@index([userId])
}

model WorkLog {
  id        String   @id @default(cuid())
  issueId   String
  authorId  String
  timeSpent Int                             // giây
  startedAt DateTime
  comment   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  issue     Issue    @relation(fields: [issueId], references: [id], onDelete: Cascade)
  author    User     @relation(fields: [authorId], references: [id])
  @@index([issueId])
}

// ============================ BOARD / SPRINT ================================
model Board {
  id                     String   @id @default(cuid())
  projectId              String
  name                   String
  type                   BoardType
  filterJql              String?
  swimlaneConfig         Json     @default("{}")
  columnConstraintConfig Json     @default("{}")
  deletedAt              DateTime?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  project Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  columns BoardColumn[]
  sprints Sprint[]

  @@index([projectId])
}

model BoardColumn {
  id       String  @id @default(cuid())
  boardId  String
  name     String
  order    Int
  wipLimit Int?
  board    Board   @relation(fields: [boardId], references: [id], onDelete: Cascade)
  statuses BoardColumnStatus[]
  @@unique([boardId, name])
  @@index([boardId])
}

model BoardColumnStatus {
  columnId String
  statusId String
  column   BoardColumn @relation(fields: [columnId], references: [id], onDelete: Cascade)
  status   Status      @relation(fields: [statusId], references: [id], onDelete: Cascade)
  @@id([columnId, statusId])
}

model Sprint {
  id           String   @id @default(cuid())
  projectId    String
  boardId      String?
  name         String
  goal         String?
  state        SprintState @default(FUTURE)
  startDate    DateTime?
  endDate      DateTime?
  completeDate DateTime?
  sequence     Int      @default(0)
  deletedAt    DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  project  Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  board    Board?  @relation(fields: [boardId], references: [id], onDelete: SetNull)
  issues   Issue[]
  snapshots SprintSnapshot[]

  @@index([projectId, state])
  @@index([boardId])
}

// ============================ CUSTOM FIELDS =================================
model CustomField {
  id          String   @id @default(cuid())
  workspaceId String
  projectId   String?
  name        String
  type        CustomFieldType
  isRequired  Boolean  @default(false)
  order       Int      @default(0)
  config      Json     @default("{}")
  deletedAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  project   Project?  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  options   CustomFieldOption[]
  values    CustomFieldValue[]

  @@index([workspaceId])
  @@index([projectId])
}

model CustomFieldOption {
  id            String @id @default(cuid())
  customFieldId String
  value         String
  color         String?
  order         Int    @default(0)
  customField   CustomField @relation(fields: [customFieldId], references: [id], onDelete: Cascade)
  @@unique([customFieldId, value])
}

model CustomFieldValue {
  id            String   @id @default(cuid())
  issueId       String
  customFieldId String
  valueText     String?  @db.Text
  valueNumber   Float?
  valueDate     DateTime?
  valueBool     Boolean?
  valueUserId   String?
  valueOptionIds String[]
  issue         Issue       @relation(fields: [issueId], references: [id], onDelete: Cascade)
  customField   CustomField @relation(fields: [customFieldId], references: [id], onDelete: Cascade)
  @@unique([issueId, customFieldId])
  @@index([customFieldId])
}

// ============================ COMMENTS / MENTIONS / ATTACH ==================
model Comment {
  id         String   @id @default(cuid())
  issueId    String
  authorId   String?
  body       String   @db.Text
  bodyFormat RichTextFormat @default(TIPTAP_JSON)
  parentId   String?
  isEdited   Boolean  @default(false)
  version    Int      @default(1)
  deletedAt  DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  issue    Issue     @relation(fields: [issueId], references: [id], onDelete: Cascade)
  author   User?     @relation(fields: [authorId], references: [id], onDelete: SetNull)
  parent   Comment?  @relation("CommentParent", fields: [parentId], references: [id], onDelete: SetNull)
  replies  Comment[] @relation("CommentParent")
  mentions Mention[]
  attachments Attachment[]

  @@index([issueId, createdAt])
  @@index([authorId])
}

model Mention {
  id              String   @id @default(cuid())
  mentionedUserId String
  commentId       String?
  issueId         String?
  createdAt       DateTime @default(now())
  comment         Comment? @relation(fields: [commentId], references: [id], onDelete: Cascade)
  issue           Issue?   @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@index([mentionedUserId])
  @@index([commentId])
}

model Attachment {
  id           String  @id @default(cuid())
  issueId      String?
  commentId    String?
  uploadedById String?
  fileName     String
  mimeType     String
  sizeBytes    Int
  storageKey   String
  checksum     String?
  createdAt    DateTime @default(now())
  issue        Issue?   @relation(fields: [issueId], references: [id], onDelete: Cascade)
  comment      Comment? @relation(fields: [commentId], references: [id], onDelete: Cascade)
  @@index([issueId])
  @@index([commentId])
}

// ============================ SEARCH / FILTER ===============================
model SavedFilter {
  id              String   @id @default(cuid())
  workspaceId     String
  ownerId         String
  name            String
  jql             String   @db.Text
  astCache        Json?
  visibility      FilterVisibility @default(PRIVATE)
  sharedProjectId String?
  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  owner         User      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  sharedProject Project?  @relation(fields: [sharedProjectId], references: [id], onDelete: SetNull)
  @@index([workspaceId, ownerId])
}

// ============================ AI / EMBEDDINGS ===============================
model IssueEmbedding {
  id          String   @id @default(cuid())
  issueId     String   @unique
  workspaceId String
  projectId   String
  contentHash String
  embedding   Unsupported("vector(1024)")     // voyage-3 default; đổi dim ⇒ migration
  model       String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  issue       Issue    @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@index([workspaceId])
  // HNSW vector_cosine_ops index: tạo bằng raw SQL migration
}

model AiSuggestion {
  id            String   @id @default(cuid())
  workspaceId   String
  issueId       String?
  kind          AiSuggestionKind
  inputContext  Json
  output        Json
  model         String
  status        AiSuggestionStatus @default(PENDING)
  requestedById String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  issue         Issue?   @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@index([issueId])
  @@index([workspaceId, kind])
}

model AiGenerationLog {
  id              String   @id @default(cuid())
  workspaceId     String?
  userId          String?
  feature         String
  model           String
  inputTokens     Int?
  outputTokens    Int?
  cacheReadTokens Int?
  estimatedCostUsd Decimal? @db.Decimal(10, 6)
  latencyMs       Int?
  success         Boolean  @default(true)
  stopReason      String?
  errorCode       String?
  requestId       String?
  createdAt       DateTime @default(now())
  @@index([workspaceId, feature, createdAt])
}

// ============================ NOTIFICATION / ACTIVITY / HISTORY =============
model Notification {
  id          String   @id @default(cuid())
  recipientId String
  workspaceId String
  type        NotificationType
  issueId     String?
  commentId   String?
  actorId     String?
  payload     Json
  readAt      DateTime?
  createdAt   DateTime @default(now())

  recipient User      @relation("NotificationRecipient", fields: [recipientId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  issue     Issue?    @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@index([recipientId, readAt])
  @@index([recipientId, createdAt])
}

model ActivityLog {
  id          String   @id @default(cuid())
  workspaceId String
  projectId   String?
  issueId     String?
  actorId     String?
  action      ActivityAction
  entityType  String
  entityId    String
  field       String?
  oldValue    Json?
  newValue    Json?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  project   Project?  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  issue     Issue?    @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@index([issueId, createdAt])
  @@index([workspaceId, createdAt])
  @@index([projectId, action, createdAt])
}

// Nguồn sự thật cho reports lịch sử (burndown/CFD/control chart/created-vs-resolved)
model IssueHistory {
  id          String   @id @default(cuid())
  issueId     String
  projectId   String
  sprintId    String?
  field       HistoryField
  oldValue    String?
  newValue    String?
  oldCategory StatusCategory?
  newCategory StatusCategory?
  pointsDelta Float?
  actorId     String
  occurredAt  DateTime
  createdAt   DateTime @default(now())

  issue Issue @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@index([issueId, occurredAt])
  @@index([sprintId, field, occurredAt])
  @@index([projectId, field, occurredAt])
  @@index([projectId, newCategory, occurredAt])
}

// ============================ REPORTS PRE-AGGREGATION =======================
model SprintSnapshot {
  id                  String   @id @default(cuid())
  sprintId            String
  kind                SnapshotKind
  snapshotAt          DateTime
  committedPoints     Float    @default(0)
  completedPoints     Float    @default(0)
  remainingPoints     Float    @default(0)
  addedPoints         Float    @default(0)
  removedPoints       Float    @default(0)
  committedCount      Int      @default(0)
  completedCount      Int      @default(0)
  payload             Json?
  createdAt           DateTime @default(now())
  sprint Sprint @relation(fields: [sprintId], references: [id], onDelete: Cascade)
  @@index([sprintId, snapshotAt])
}

model ReportCache {
  id         String   @id @default(cuid())
  cacheKey   String   @unique
  reportType String
  scopeId    String
  payload    Json
  computedAt DateTime @default(now())
  expiresAt  DateTime
  @@index([scopeId, reportType])
  @@index([expiresAt])
}

// ============================ DASHBOARD =====================================
model Dashboard {
  id          String   @id @default(cuid())
  workspaceId String
  ownerId     String
  projectId   String?
  name        String
  description String?
  scope       DashboardScope @default(PRIVATE)
  isDefault   Boolean  @default(false)
  layout      Json     @default("{}")
  deletedAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  owner     User      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  project   Project?  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  widgets   Widget[]
  @@index([workspaceId, ownerId])
  @@index([projectId, scope])
}

model Widget {
  id          String   @id @default(cuid())
  dashboardId String
  type        WidgetType
  title       String
  config      Json     @default("{}")
  position    Json     @default("{}")
  refreshSec  Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  dashboard   Dashboard @relation(fields: [dashboardId], references: [id], onDelete: Cascade)
  @@index([dashboardId])
}

// ============================ AUTH ==========================================
model RefreshToken {
  id         String   @id @default(cuid())
  userId     String
  tokenHash  String   @unique
  family     String
  expiresAt  DateTime
  revokedAt  DateTime?
  userAgent  String?
  ipAddress  String?
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([tokenHash])
}
```

**Raw SQL migration `0001_pgvector_fts/migration.sql`** (chạy sau migrate tạo bảng):
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Full-text search generated column trên Issue
ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("summary", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B') ||
    to_tsvector('simple', coalesce("key", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS issue_search_gin   ON "Issue" USING gin ("searchVector");
CREATE INDEX IF NOT EXISTS issue_summary_trgm ON "Issue" USING gin ("summary" gin_trgm_ops);

-- HNSW cho semantic search (cosine)
CREATE INDEX IF NOT EXISTS issue_embedding_hnsw
  ON "IssueEmbedding" USING hnsw (embedding vector_cosine_ops);
```

---

## 4. Quyết định cross-cutting (chốt)

### 4.1 Auth flow (JWT access + refresh rotation)
- **Access token** JWT 15m, payload `{ sub, email, workspaceId, jti }`. **Permission KHÔNG nhúng token** (resolve runtime + cache Redis 60s).
- **Refresh token** 7d, **rotation + family**, lưu **hash** trong `RefreshToken`. Reuse detection → revoke cả family → 401.
- Hash password: **argon2id** (ưu tiên) hoặc bcrypt(12).
- Truyền refresh qua **httpOnly Secure cookie** (`SameSite=Strict`); access token giữ **in-memory** ở frontend (Zustand, không persist) → chống XSS.
- Endpoints: `POST /auth/register|login|refresh|logout`, `GET /auth/me` (trả `user + memberships + permissions[]`).
- Socket auth: access token trong `handshake.auth.token`; refresh qua REST rồi reconnect (không refresh qua socket).

### 4.2 RBAC model (CASL, 2 cấp scope)
- Permission = string `resource:action` (vd `issue:create`, `issue:transition`, `sprint:manage`, `board:manage`, `workflow:edit`, `member:manage`, `project:admin`, `workspace:admin`, `report:view`, `dashboard:manage`). Biến thể ownership `:own`.
- Effective permission = union(workspace role) ∪ (project role), resolve qua `Permission/Role/RolePermission/*Membership`.
- `@Permissions('issue:create')` (route-level coarse) + CASL `AbilityFactory` (fine-grained ownership). `PermissionsGuard` resolve `projectId` từ path, cache ở Redis, invalidate khi `member.role_changed`.
- System roles seed: WORKSPACE — `Workspace Admin / Member / Viewer`; PROJECT — `Project Admin / Developer / Reporter`.

### 4.3 Response envelope
```jsonc
// single — trả thẳng object (200/201), KHÔNG bọc cho single resource ở detail/create
// list — luôn bọc:
{ "success": true, "data": [...],
  "pageInfo": { "hasNextPage": true, "endCursor": "...", "limit": 25 },   // cursor mode
  "meta": { "requestId": "...", "timestamp": "..." } }
// offset mode pageInfo: { "page", "pageSize", "totalItems", "totalPages" }
// async (AI nặng): 202 { "jobId": "..." } → kết quả qua WS
```
Chốt: ResponseInterceptor bọc list; single resource trả raw object. Header `X-Request-Id` xuyên REST↔WS↔log.

### 4.4 Error format
```jsonc
{ "success": false,
  "error": { "code": "ISSUE_NOT_FOUND", "message": "...", "statusCode": 404,
             "details": [{ "field": "summary", "code": "REQUIRED", "message": "..." }] },
  "meta": { "requestId": "...", "timestamp": "...", "path": "..." } }
```
Codes: `VALIDATION_ERROR(400)`, `JQL_PARSE_ERROR(400)`, `UNAUTHENTICATED/TOKEN_EXPIRED(401)`, `FORBIDDEN(403)`, `*_NOT_FOUND(404)`, `INVALID_TRANSITION/VERSION_CONFLICT(409)`, `BUSINESS_RULE_VIOLATION(422)`, `RATE_LIMITED(429)`, `AI_UNAVAILABLE(503)`. Filter order: `PrismaExceptionFilter` (P2002→409, P2025→404, P2003→409) → `AllExceptionsFilter`.

### 4.5 Validation
- Backend: global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` + class-validator DTO. Zod schemas dùng chung đặt ở `@tirapro/shared`.
- Frontend: react-hook-form + `zodResolver`, import schema từ `@tirapro/shared` khi khả thi.

### 4.6 Naming conventions
| Hạng mục | Quy ước |
|---|---|
| Prisma model | PascalCase singular; field camelCase; enum PascalCase |
| REST route | `api/v1/<plural>` lồng theo cha; action = verb POST (`/issues/:id/transitions`) |
| Permission | `resource:action` (+`:own`) |
| Event nội bộ (EventEmitter2) | `domain.action` (`issue.moved`) |
| WS event | `domain:action` (`issue:moved`) |
| Error code | `SCREAMING_SNAKE_CASE` |
| Queue | `kebab-case` |
| Env | `SCREAMING_SNAKE_CASE`; client phải prefix `VITE_` |
| ID | CUID string; Date ISO-8601 UTC |
| Ordering | LexoRank string; concurrency = OCC `version` |
| Commit | Conventional Commits, scope = package (`feat(api)`, `fix(web)`) |

### 4.7 Realtime contract chốt
- Rooms: `ws:{workspaceId}`, `user:{userId}` (auto on connect); `project:{id}`, `board:{id}`, `backlog:{projectId}`, `issue:{id}`, `sprint:{id}` (subscribe có RBAC check).
- Domain service commit DB → `EventEmitter2.emit('issue.moved', …)` → `RealtimeBridge @OnEvent` → broadcast. Gateway KHÔNG chứa business logic.
- Mọi mutation mang `version` (OCC); 409 `VERSION_CONFLICT` kèm state hiện tại → client reconcile (last-write-wins cho move; field-merge cho update).
- Scale-out: `@socket.io/redis-adapter`. Presence/typing ở Redis (TTL), KHÔNG ở Postgres. Reconnect → re-subscribe + invalidate queries.

---

## 5. BUILD ORDER (roadmap "all-in" theo phụ thuộc)

> Mỗi chunk: **[layer]** tên — mô tả — *phụ thuộc*.

**PHASE 0 — Foundation (infra + contracts)**
1. **[infra]** Monorepo skeleton — fix `docker-compose.yml` sang `pgvector/pgvector:pg16` + initdb extensions; turbo.json; tsconfig/eslint/prettier/husky packages; `.env.example`. *Dep: —*
2. **[shared]** `@tirapro/types` — enums MASTER (IssueType, Priority, BoardType, SprintState, StatusCategory…) + interfaces DTO/event. *Dep: 1*
3. **[shared]** `@tirapro/shared` — Zod schemas (auth/issue/env), WS event payload types, JQL grammar types, constants. *Dep: 2*
4. **[infra/api]** Prisma schema (mục 3) + migrations (init + raw pgvector/fts) + PrismaService + soft-delete extension. *Dep: 1*
5. **[api]** App bootstrap — `main.ts` (pipes/filters/interceptors/CORS/helmet/versioning/swagger), ConfigModule + env.validation, common/* (decorators, guards skeleton, envelope, error filters, pagination), RedisModule, HealthModule. *Dep: 4*

**PHASE 1 — Security core**
6. **[api]** AuthModule — register/login/refresh-rotation/logout/me, JwtStrategy, RefreshToken. *Dep: 5*
7. **[api]** UsersModule. *Dep: 6*
8. **[api]** RbacModule — Permission/Role/RolePermission, CASL AbilityFactory, PermissionsGuard, permission cache. *Dep: 6,7*
9. **[infra/api]** Seed v1 — permission catalog + system roles + demo users. *Dep: 8*

**PHASE 2 — Project domain**
10. **[api]** WorkspacesModule + MembersModule (workspace/project membership + role assignment). *Dep: 8*
11. **[api]** ProjectsModule — CRUD, issue key sequence (atomic increment trong $transaction). *Dep: 10*
12. **[api]** WorkflowsModule — Status/Transition, `assertTransitionAllowed`. *Dep: 11*
13. **[api]** CustomFieldsModule — field def + typed values. *Dep: 11*

**PHASE 3 — Issue core**
14. **[api]** IssuesModule — CRUD, hierarchy (parent/epic), links, LexoRank, transition (gọi Workflows), OCC version, labels/components/versions. *Dep: 12,13*
15. **[api]** ActivityModule + IssueHistory ingest (`@OnEvent issue.changed`) — append-only audit + nguồn reports. *Dep: 14*
16. **[api]** CommentsModule (+@mentions) + AttachmentsModule (Storage abstraction local/S3). *Dep: 14*

**PHASE 4 — Agile views**
17. **[api]** BoardsModule (columns↔statuses, swimlane, WIP). *Dep: 14*
18. **[api]** SprintsModule (start/complete + SprintSnapshot khi close) + BacklogModule (rank). *Dep: 14,17*

**PHASE 5 — Realtime + async**
19. **[infra/api]** Queue (BullMQ) + RealtimeModule (gateway, WsJwtGuard, rooms, RedisIoAdapter, presence/typing) + RealtimeBridge (@OnEvent → broadcast). *Dep: 5,14,16,18*
20. **[api]** NotificationsModule (event → record → WS `notification:new` + email queue). *Dep: 19,15*

**PHASE 6 — Search, reports, AI**
21. **[api]** SearchModule — JQL lexer/parser → AST → Prisma where (whitelist + tenant scope) + full-text. *Dep: 14*
22. **[api]** ReportsModule + DashboardsModule — burndown/velocity/CFD/control/created-vs-resolved từ IssueHistory/SprintSnapshot + ReportCache; export PDF(pdfkit/exceljs)/Excel. *Dep: 15,18*
23. **[api]** AiModule — ClaudeService (adaptive thinking, structured output, no sampling params, no prefill), AiAvailabilityService, features (generate/summarize/suggest/sprint-plan/semantic-search), EmbeddingsClient (Voyage/OpenAI, degrade→FTS), SSE/gateway streaming, heuristic fallbacks. *Dep: 14,18,21,19*

**PHASE 7 — Frontend (song song từ Phase 1 sau khi contracts sẵn sàng)**
24. **[web]** Foundation — Vite/Tailwind/shadcn, design tokens (light/dark) + theme store + anti-FOUC, `cn`, primitives P0 (Button/Input/Select/Dialog/Dropdown/Tooltip/Avatar/Badge/Toast/Skeleton/Command). *Dep: 2,3*
25. **[web]** App shell — providers (QueryClient/Theme/Socket), router + guards, AppShell/Sidebar/Topbar, axios + refresh interceptor + queryKeys factory, socket singleton, command palette + hotkeys. *Dep: 24,6*
26. **[web]** Auth pages + RequireAuth/RequirePermission. *Dep: 25,6*
27. **[web]** Projects + Issues feature — list/detail (drawer+route), CreateIssueDialog, custom fields render, transitions, optimistic mutations. *Dep: 26,14*
28. **[web]** Board (dnd-kit + optimistic + realtime reconcile) + Backlog (virtualized, cross-container DnD) + Sprints. *Dep: 27,17,18,19*
29. **[web]** Comments/Attachments/Presence/Notifications UI + realtime hooks. *Dep: 28,16,20*
30. **[web]** Search (JQL + semantic) + Reports (recharts) + Dashboard (react-grid-layout) + export buttons. *Dep: 27,21,22*
31. **[web]** AI UI (degrade qua `GET /ai/capabilities`) — generate/summarize/suggest/sprint planner/semantic toggle + streaming hooks. *Dep: 30,23*
32. **[web]** PWA (vite-plugin-pwa) + mobile responsive polish + a11y pass (axe). *Dep: 31*

**PHASE 8 — Hoàn thiện**
33. **[infra]** Seed v2 đầy đủ (2 project SCRUM/KANBAN, sprints + snapshots, 30–50 issues, comments/mentions, dashboards, backfill embeddings nếu có key). *Dep: 18,22,23*
34. **[infra]** CI (GitHub Actions: lint/typecheck/build/test/e2e, `ANTHROPIC_API_KEY=""` verify degrade) + README quickstart. *Dep: tất cả*

---

## 6. Danh sách .env variables đầy đủ

```dotenv
# ---------- Node ----------
NODE_ENV=development

# ---------- PostgreSQL (image: pgvector/pgvector:pg16) ----------
POSTGRES_USER=tirapro
POSTGRES_PASSWORD=tirapro
POSTGRES_DB=tirapro
POSTGRES_PORT=5432
DATABASE_URL="postgresql://tirapro:tirapro@localhost:5432/tirapro?schema=public&connection_limit=10&pool_timeout=20"

# ---------- Redis (socket.io adapter + BullMQ + cache + presence + throttle) ----------
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_URL="redis://localhost:6379"

# ---------- Adminer ----------
ADMINER_PORT=8080

# ---------- API (NestJS) ----------
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
API_VERSION=v1
CORS_ORIGIN=http://localhost:5173

# ---------- Auth (JWT access + refresh rotation) ----------
JWT_ACCESS_SECRET=change_me_access_secret_min_32_chars_long
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars_long
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_ROUNDS=12          # dùng nếu chọn bcrypt; argon2id ưu tiên (không cần biến)

# ---------- Realtime (Socket.io) ----------
WS_PATH=/realtime
WS_USE_REDIS_ADAPTER=true

# ---------- Storage (Attachments) ----------
STORAGE_DRIVER=local      # local | s3
STORAGE_LOCAL_DIR=./uploads
MAX_FILE_SIZE_MB=25
S3_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_FORCE_PATH_STYLE=true  # cho MinIO

# ---------- AI: Anthropic Claude (thiếu key → degrade gracefully) ----------
ANTHROPIC_API_KEY=
AI_FEATURES_ENABLED=true
AI_MODEL_PRIMARY=claude-opus-4-8      # reasoning nặng: generate issue, sprint plan, suggest
AI_MODEL_FAST=claude-sonnet-4-6       # throughput: summarize
AI_MONTHLY_TOKEN_QUOTA_PER_WORKSPACE=5000000

# ---------- AI: Embeddings (Anthropic KHÔNG có embedding API) ----------
EMBEDDING_PROVIDER=voyage             # voyage | openai | none(→full-text fallback)
EMBEDDING_DIM=1024                    # voyage-3=1024; openai text-embedding-3-small=1536 (đổi ⇒ migration+reindex)
VOYAGE_API_KEY=
VOYAGE_MODEL=voyage-3
OPENAI_API_KEY=
OPENAI_EMBEDDINGS_MODEL=text-embedding-3-small

# ---------- Rate limiting (@nestjs/throttler qua Redis) ----------
THROTTLE_TTL=60
THROTTLE_LIMIT=100

# ---------- Web (Vite — chỉ biến VITE_* lộ ra client, KHÔNG đặt secret) ----------
VITE_API_URL=http://localhost:4000/api/v1
VITE_WS_URL=http://localhost:4000
VITE_APP_NAME=Tirapro
VITE_ENABLE_PWA=true
```

**Lưu ý vận hành then chốt:**
1. `docker-compose.yml` đã scaffold dùng `postgres:16-alpine` — **PHẢI đổi** sang `pgvector/pgvector:pg16` để có extension `vector`.
2. `.env.example` là single source of truth: mọi biến mới phải thêm vào đây.
3. Thiếu `ANTHROPIC_API_KEY` → AI heuristic/disabled; thiếu embedding key → semantic search fallback full-text; Redis down → REST vẫn chạy. App **luôn boot được** với `docker compose up` + `pnpm setup` + `pnpm dev`.