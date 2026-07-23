# Analytics, Reports & Dashboards

Đây là task viết đặc tả thiết kế cho subsystem "Analytics, Reports & Dashboards". Tôi sẽ kiểm tra xem có liên quan đến Claude API không — có, vì subsystem này giao tiếp với AI subsystem. Nhưng phần chính là analytics. Tôi sẽ tạo bản đặc tả markdown chi tiết. Đây là greenfield, thư mục trống, nên không cần đọc code hiện có.

Tôi sẽ viết trực tiếp bản đặc tả. Đây là deliverable dạng nội dung, không cần file — trả về verbatim theo yêu cầu.

# Đặc tả Thiết kế: Analytics, Reports & Dashboards

> Subsystem thuộc dự án **Tirapro**. Phạm vi: các báo cáo Agile (Burndown, Velocity, CFD, Sprint report, Control chart, Created vs Resolved), Dashboard tùy biến (Dashboard + Widget), và Export (PDF/Excel). Tài liệu này đủ chi tiết để lập trình trực tiếp trên tech stack đã chốt (NestJS 10 + Prisma + PostgreSQL, React 18 + Vite + TanStack Query + recharts).

---

## 1. Tổng quan kiến trúc subsystem

```
                    ┌──────────────────────────────────────────────┐
                    │            Frontend (React + recharts)         │
                    │  ReportsPage · DashboardCanvas · WidgetCards   │
                    └───────────────┬───────────────────────────────┘
                                    │ HTTP (TanStack Query) + WS (invalidate)
                    ┌───────────────▼───────────────────────────────┐
                    │         AnalyticsModule (NestJS)               │
                    │  ┌──────────────┐  ┌────────────────────────┐  │
                    │  │ ReportsCtrl  │  │ DashboardsCtrl         │  │
                    │  └──────┬───────┘  └──────────┬─────────────┘  │
                    │  ┌──────▼───────────────────────────────────┐ │
                    │  │ Report Services (Burndown/Velocity/CFD…)  │ │
                    │  └──────┬────────────────────────────┬──────┘ │
                    │  ┌──────▼──────┐  ┌──────────────────▼──────┐ │
                    │  │ ExportSvc   │  │ AggregationSvc (caching) │ │
                    │  │ (PDF/Excel) │  └──────────────────────────┘ │
                    └─────────────────────┬──────────────────────────┘
                                          │ Prisma
                    ┌─────────────────────▼──────────────────────────┐
                    │  PostgreSQL                                      │
                    │  IssueHistory · SprintSnapshot (pre-agg) ·       │
                    │  Dashboard · Widget · ReportCache                │
                    └──────────────────────────────────────────────────┘
                                          ▲
                    ┌─────────────────────┴──────────────────────────┐
                    │ Event source: Issues subsystem phát IssueChanged │
                    │ → AnalyticsModule ghi IssueHistory (lịch sử)     │
                    └──────────────────────────────────────────────────┘
```

**Nguyên tắc nền tảng**: mọi báo cáo Agile đều cần **lịch sử trạng thái issue theo thời gian**, không thể tính từ trạng thái hiện tại. Vì vậy subsystem này sở hữu (owns) bảng `IssueHistory` và bảng pre-aggregation `SprintSnapshot`/`ReportCache`. Đây là trái tim của thiết kế.

---

## 2. Điểm giao tiếp với các subsystem khác (Integration contract)

| Subsystem | Hướng | Hợp đồng |
|-----------|-------|----------|
| **Issues / Workflows** | inbound | Phát domain event `issue.changed` qua một in-process EventEmitter (NestJS `@nestjs/event-emitter`). Analytics lắng nghe và ghi `IssueHistory`. Bắt buộc bao gồm: `issueId, projectId, sprintId, field, oldValue, newValue, actorId, occurredAt`. Các field quan tâm: `status` (statusId + statusCategory: TODO/IN_PROGRESS/DONE), `storyPoints`, `sprintId`, `assigneeId`, `issueType`, `resolution`. |
| **Sprints** | inbound | Cần `Sprint { id, name, startDate, endDate, completeDate, state, goal }` và quan hệ `Issue.sprintId`. Khi sprint chuyển `state=CLOSED` → phát `sprint.closed` → Analytics chốt `SprintSnapshot` cuối cùng (committed vs completed). |
| **Projects / Boards** | inbound | `Board { columnConfig }` ánh xạ statusId → tên cột để vẽ CFD/Control chart theo cột board. `workingDays` config (loại bỏ T7/CN khỏi burndown ideal line). |
| **RBAC / Auth** | inbound | Guard `JwtAuthGuard` + `PermissionGuard('VIEW_REPORTS')`, `MANAGE_DASHBOARD`. Dashboard có scope `private/project/global`; chia sẻ kiểm tra qua RBAC subsystem. |
| **AI subsystem** | outbound (tùy chọn) | Widget loại `ai-insight` gọi `POST /ai/analyze-report` của AI subsystem (Anthropic Claude `claude-sonnet-4-6`). Khi thiếu API key → AI subsystem trả `503/feature-disabled`; Analytics **degrade gracefully**: widget hiển thị dữ liệu thô + badge "AI insights unavailable". Không bao giờ block render report. |
| **Realtime (Socket.io)** | outbound | Khi `IssueHistory` mới ghi cho 1 sprint đang mở → emit `report:invalidate { projectId, sprintId, reportTypes[] }` tới room `project:{id}` để FE invalidate query (live burndown). |
| **Notifications** | n/a | Không trực tiếp; export job hoàn tất có thể nhờ Notifications gửi "Your export is ready". |

---

## 3. Data model (Prisma schema)

### 3.1. `IssueHistory` — nguồn sự thật cho mọi báo cáo lịch sử

```prisma
// Mỗi thay đổi field-level của issue = 1 dòng. Append-only, không update.
model IssueHistory {
  id             String   @id @default(cuid())
  issueId        String
  projectId      String
  sprintId       String?           // sprint tại thời điểm thay đổi (denormalized để query nhanh)
  field          HistoryField      // STATUS | STORY_POINTS | SPRINT | ASSIGNEE | TYPE | RESOLUTION | SCOPE
  oldValue       String?           // raw string; với STATUS lưu statusId
  newValue       String?
  // Denormalized cho STATUS để tránh join workflow khi vẽ CFD/control chart:
  oldCategory    StatusCategory?   // TODO | IN_PROGRESS | DONE
  newCategory    StatusCategory?
  // Snapshot story points tại thời điểm (cho burndown “scope change”):
  pointsDelta    Float?            // +/- điểm gây ra bởi thay đổi này (scope add/remove/complete)
  actorId        String
  occurredAt     DateTime          // thời điểm logic của sự kiện (KHÔNG dùng createdAt)
  createdAt      DateTime @default(now())

  @@index([issueId, occurredAt])
  @@index([sprintId, field, occurredAt])      // burndown / sprint report
  @@index([projectId, field, occurredAt])     // created vs resolved / CFD project-level
  @@index([projectId, newCategory, occurredAt])
}

enum HistoryField { STATUS STORY_POINTS SPRINT ASSIGNEE TYPE RESOLUTION SCOPE PRIORITY }
enum StatusCategory { TODO IN_PROGRESS DONE }
```

> **Cách sinh dữ liệu**: Issues subsystem tạo issue → phát event với `field=STATUS, newValue=<initialStatus>, occurredAt=createdAt`. Mọi transition/edit sau đó → 1 event/field. Để hỗ trợ "Created vs Resolved" ta đảm bảo luôn có dòng đầu tiên (created) và dòng `RESOLUTION` khi resolve.

### 3.2. `SprintSnapshot` — pre-aggregation cho Velocity & Sprint report (chốt khi đóng sprint)

```prisma
model SprintSnapshot {
  id                 String   @id @default(cuid())
  sprintId           String   @unique
  projectId          String
  // Velocity:
  committedPoints    Float    // tổng SP của issue trong sprint tại thời điểm sprint START
  completedPoints    Float    // tổng SP của issue DONE trước/đúng completeDate
  committedCount     Int
  completedCount     Int
  // Sprint report details:
  addedDuringSprint  Json     // [{issueId, points}] scope thêm sau khi bắt đầu
  removedDuringSprint Json
  notCompleted       Json     // issue chưa done -> spill sang sprint sau
  // Burndown ideal/actual đã materialize (xem 4.1):
  burndownSeries     Json     // [{date, remaining, ideal, completed, scope}]
  closedAt           DateTime
  createdAt          DateTime @default(now())

  @@index([projectId, closedAt])
}
```

### 3.3. `ReportCache` — cache kết quả tính toán nặng (CFD, control chart, live burndown)

```prisma
model ReportCache {
  id          String   @id @default(cuid())
  cacheKey    String   @unique   // hash(reportType + params normalized)
  reportType  String
  scopeId     String              // projectId hoặc sprintId
  payload     Json                // ChartDataDTO đã sẵn sàng cho recharts
  computedAt  DateTime @default(now())
  expiresAt   DateTime            // TTL; live report TTL ngắn (60s), closed sprint TTL dài

  @@index([scopeId, reportType])
  @@index([expiresAt])
}
```

### 3.4. `Dashboard` & `Widget`

```prisma
model Dashboard {
  id          String   @id @default(cuid())
  name        String
  description String?
  ownerId     String
  projectId   String?            // null = global/cross-project
  scope       DashboardScope @default(PRIVATE) // PRIVATE | PROJECT | GLOBAL
  isDefault   Boolean  @default(false)
  layout      Json     // react-grid-layout: [{ i, x, y, w, h, minW, minH }]
  widgets     Widget[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([ownerId])
  @@index([projectId, scope])
}

enum DashboardScope { PRIVATE PROJECT GLOBAL }

model Widget {
  id           String   @id @default(cuid())
  dashboardId  String
  dashboard    Dashboard @relation(fields: [dashboardId], references: [id], onDelete: Cascade)
  type         WidgetType
  title        String
  config       Json     // tùy theo type (xem 6.2) — projectId, sprintId, boardId, jql, dateRange, groupBy…
  position     Json     // { i, x, y, w, h } đồng bộ với Dashboard.layout (i = widget.id)
  refreshSec   Int?     // auto-refresh; null = chỉ refresh thủ công/realtime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([dashboardId])
}

enum WidgetType {
  BURNDOWN VELOCITY CFD SPRINT_REPORT CONTROL_CHART CREATED_VS_RESOLVED
  STAT_NUMBER          // single metric (e.g. open bugs)
  ISSUE_LIST           // JQL-driven table
  PIE_BY_FIELD         // breakdown theo assignee/type/priority
  AI_INSIGHT           // gọi AI subsystem
}
```

---

## 4. Đặc tả từng báo cáo

Mỗi báo cáo dưới đây mô tả: **nguồn dữ liệu → công thức → endpoint → shape cho recharts**.

### 4.1. Burndown Chart

- **Mục đích**: theo dõi remaining work (story points hoặc issue count) so với ideal line trong 1 sprint.
- **Nguồn dữ liệu**: `IssueHistory` lọc theo `sprintId`, field `STATUS` (xác định thời điểm DONE), `STORY_POINTS` & `SCOPE`/`SPRINT` (xác định scope change). Cần `Sprint.startDate/endDate` và `Board.workingDays`.
- **Công thức**:
  - Trục thời gian: mỗi ngày `d` từ `startDate` → `endDate`.
  - `committed₀` = tổng SP issue thuộc sprint tại `startDate`.
  - `remaining(d)` = `committed₀ + Σ scopeAdded(≤d) − Σ scopeRemoved(≤d) − Σ completed(≤d)`, trong đó `completed` = issue chuyển sang `newCategory=DONE` (lấy lần DONE đầu tiên; nếu reopen rồi done lại → xử lý net theo `occurredAt`).
  - `ideal(d)` = đường thẳng từ `committed₀` về `0`, chia đều **chỉ trên working days** (bỏ T7/CN/holidays): `ideal(dₖ) = committed₀ × (1 − k / totalWorkingDays)`.
- **Pre-aggregation**: sprint đang mở → tính on-the-fly + cache TTL 60s. Sprint đã đóng → đọc `SprintSnapshot.burndownSeries` (bất biến).
- **Endpoint**: `GET /api/reports/burndown?sprintId=&unit=points|count`
- **Shape (recharts `ComposedChart`: Area/Line)**:
```jsonc
{
  "unit": "points",
  "startDate": "2026-06-01", "endDate": "2026-06-14",
  "series": [
    { "date": "2026-06-01", "remaining": 40, "ideal": 40, "completed": 0,  "scopeChange": 0 },
    { "date": "2026-06-02", "remaining": 38, "ideal": 36, "completed": 2,  "scopeChange": 0 },
    { "date": "2026-06-03", "remaining": 45, "ideal": 32, "completed": 2,  "scopeChange": 7 }  // scope added
    // … weekends: ideal giữ nguyên (flat)
  ]
}
```

### 4.2. Velocity Chart

- **Mục đích**: so committed vs completed points qua N sprint gần nhất để dự báo capacity.
- **Nguồn dữ liệu**: `SprintSnapshot` (đã chốt). Đây là lý do snapshot tồn tại — velocity không bao giờ tính lại từ history.
- **Công thức**: mỗi sprint đóng → 1 cặp `(committedPoints, completedPoints)`. `averageVelocity = mean(completedPoints các sprint gần nh
ất)`.
- **Endpoint**: `GET /api/reports/velocity?projectId=&boardId=&last=7`
- **Shape (recharts grouped `BarChart`)**:
```jsonc
{
  "averageVelocity": 31.2,
  "sprints": [
    { "sprintId": "s1", "name": "Sprint 1", "committed": 34, "completed": 28 },
    { "sprintId": "s2", "name": "Sprint 2", "committed": 30, "completed": 32 }
  ]
}
```

### 4.3. Cumulative Flow Diagram (CFD)

- **Mục đích**: số issue ở mỗi status/column theo thời gian → phát hiện bottleneck (band phình to) & WIP.
- **Nguồn dữ liệu**: `IssueHistory` field `STATUS` trong khoảng `[from, to]`, ánh xạ statusId → column qua `Board.columnConfig`.
- **Công thức**: với mỗi ngày `d`, với mỗi column `c`: `count(c, d) = số issue có status ∈ c tại thời điểm cuối ngày d`. Tính bằng cách reconstruct trạng thái: duyệt history theo `occurredAt`, maintain map `issueId → currentColumn`, snapshot cuối mỗi ngày. CFD là **stacked area** theo thứ tự column từ Done (đáy) lên Todo (đỉnh) hoặc ngược tùy convention.
- **Pre-aggregation**: nặng → cache theo `(projectId|boardId, from, to, granularity)`, TTL theo độ "live".
- **Endpoint**: `GET /api/reports/cfd?boardId=&from=&to=&granularity=day|week`
- **Shape (recharts stacked `AreaChart`)**:
```jsonc
{
  "columns": ["To Do", "In Progress", "Review", "Done"],   // thứ tự vẽ
  "series": [
    { "date": "2026-06-01", "To Do": 12, "In Progress": 4, "Review": 1, "Done": 3 },
    { "date": "2026-06-02", "To Do": 10, "In Progress": 6, "Review": 2, "Done": 4 }
  ]
}
```

### 4.4. Sprint Report

- **Mục đích**: tổng kết 1 sprint khi đóng: completed / not completed / removed / scope change, completion rate.
- **Nguồn dữ liệu**: `SprintSnapshot` (chính) + join `Issue` để hiển thị chi tiết (key, summary, assignee).
- **Công thức**: `completionRate = completedPoints / committedPoints`; `scopeChange = Σ added − Σ removed`.
- **Endpoint**: `GET /api/reports/sprint/:sprintId`
- **Shape**:
```jsonc
{
  "sprint": { "id": "s2", "name": "Sprint 2", "goal": "Checkout flow", "completionRate": 0.93 },
  "committedPoints": 30, "completedPoints": 28,
  "completedIssues":   [{ "key": "PJ-12", "summary": "...", "points": 5, "assignee": "An" }],
  "notCompletedIssues":[{ "key": "PJ-19", "summary": "...", "points": 2 }],
  "removedIssues":     [],
  "addedDuringSprint": [{ "key": "PJ-25", "points": 3 }]
}
```

### 4.5. Control Chart

- **Mục đích**: phân phối **cycle time / lead time** của issue đã hoàn thành → ổn định quy trình.
- **Nguồn dữ liệu**: `IssueHistory` field `STATUS`. Với mỗi issue đã `DONE`:
  - `cycleTime` = `occurredAt(first IN_PROGRESS)` → `occurredAt(DONE)`.
  - `leadTime` = `created` → `occurredAt(DONE)`.
- **Công thức**: scatter mỗi issue tại (ngày done, cycleTime). `rollingMean` & `±stdDev band` qua cửa sổ trượt (vd 7 ngày) → control limits. Loại working-hours nếu cấu hình (đơn giản hóa: tính theo calendar hours, ghi rõ trong UI).
- **Endpoint**: `GET /api/reports/control-chart?projectId=&boardId=&from=&to=&metric=cycle|lead`
- **Shape (recharts `ScatterChart` + 3 `Line`)**:
```jsonc
{
  "metric": "cycle", "unit": "hours",
  "points": [
    { "issueKey": "PJ-12", "doneAt": "2026-06-05", "value": 18.5 },
    { "issueKey": "PJ-13", "doneAt": "2026-06-06", "value": 42.0 }
  ],
  "rollingMean": [{ "date": "2026-06-05", "mean": 22, "upper": 50, "lower": 4 }]
}
```

### 4.6. Created vs Resolved

- **Mục đích**: theo dõi backlog health — tốc độ tạo issue vs giải quyết.
- **Nguồn dữ liệu**: `IssueHistory` — `created` = dòng đầu tiên của issue (field STATUS, oldValue null); `resolved` = dòng field `RESOLUTION` (newValue != null) hoặc lần đầu `newCategory=DONE`.
- **Công thức**: theo bucket (day/week): `created(b)`, `resolved(b)`, `cumulativeOpen(b) = cumulativeCreated − cumulativeResolved`.
- **Endpoint**: `GET /api/reports/created-vs-resolved?projectId=&from=&to=&granularity=&jql=`
- **Shape (recharts `ComposedChart`: 2 Line + 1 Area cumulative)**:
```jsonc
{
  "series": [
    { "date": "2026-W22", "created": 14, "resolved": 9,  "cumulativeOpen": 5 },
    { "date": "2026-W23", "created": 11, "resolved": 15, "cumulativeOpen": 1 }
  ]
}
```

---

## 5. Backend implementation (NestJS)

### 5.1. Cấu trúc module

```
backend/src/analytics/
├── analytics.module.ts
├── controllers/
│   ├── reports.controller.ts
│   └── dashboards.controller.ts
├── services/
│   ├── issue-history.service.ts        // listener event + ghi history
│   ├── snapshot.service.ts             // chốt SprintSnapshot khi sprint close
│   ├── aggregation.service.ts          // cache + TTL + reconstruct state
│   ├── reports/
│   │   ├── burndown.service.ts
│   │   ├── velocity.service.ts
│   │   ├── cfd.service.ts
│   │   ├── sprint-report.service.ts
│   │   ├── control-chart.service.ts
│   │   └── created-resolved.service.ts
│   ├── dashboard.service.ts
│   └── export.service.ts               // PDF/Excel
├── dto/                                // class-validator DTO cho mọi query/body
└── interfaces/chart-data.interface.ts  // shared shapes với FE (xuất sang packages/shared)
```

> **Chia sẻ type với FE**: định nghĩa các `*ChartDataDTO` trong `packages/shared` (monorepo workspace) để FE/BE dùng chung, tránh lệch shape.

### 5.2. Ingest history (listener)

```typescript
@Injectable()
export class IssueHistoryService {
  constructor(private prisma: PrismaService, private gateway: AnalyticsGateway) {}

  @OnEvent('issue.changed')
  async onIssueChanged(e: IssueChangedEvent) {
    const rows = e.changes.map((c) => ({
      issueId: e.issueId, projectId: e.projectId, sprintId: e.sprintId,
      field: c.field, oldValue: c.oldValue, newValue: c.newValue,
      oldCategory: c.oldCategory, newCategory: c.newCategory,
      pointsDelta: c.pointsDelta, actorId: e.actorId, occurredAt: e.occurredAt,
    }));
    await this.prisma.issueHistory.createMany({ data: rows });

    // invalidate cache + realtime nếu sprint đang mở
    if (e.sprintId) {
      await this.aggregation.invalidate(e.sprintId, ['burndown', 'cfd', 'control-chart']);
      this.gateway.emitReportInvalidate(e.projectId, e.sprintId,
        ['burndown', 'cfd', 'control-chart']);
    }
  }
}
```

### 5.3. AggregationService (caching + reconstruct)

```typescript
@Injectable()
export class AggregationService {
  // get-or-compute với TTL theo độ "live" của scope
  async cached<T>(key: string, type: string, scopeId: string,
                  ttlSec: number, compute: () => Promise<T>): Promise<T> {
    const hit = await this.prisma.reportCache.findUnique({ where: { cacheKey: key } });
    if (hit && hit.expiresAt > new Date()) return hit.payload as T;
    const payload = await compute();
    await this.prisma.reportCache.upsert({
      where: { cacheKey: key },
      create: { cacheKey: key, reportType: type, scopeId, payload,
                expiresAt: new Date(Date.now() + ttlSec * 1000) },
      update: { payload, computedAt: new Date(),
                expiresAt: new Date(Date.now() + ttlSec * 1000) },
    });
    return payload;
  }
}
```

### 5.4. Endpoints tổng hợp

| Method | Path | Mô tả | Permission |
|--------|------|-------|-----------|
| GET | `/api/reports/burndown` | Burndown 1 sprint | VIEW_REPORTS |
| GET | `/api/reports/velocity` | Velocity N sprint | VIEW_REPORTS |
| GET | `/api/reports/cfd` | Cumulative Flow | VIEW_REPORTS |
| GET | `/api/reports/sprint/:sprintId` | Sprint report | VIEW_REPORTS |
| GET | `/api/reports/control-chart` | Control chart | VIEW_REPORTS |
| GET | `/api/reports/created-vs-resolved` | Created vs Resolved | VIEW_REPORTS |
| POST | `/api/reports/:type/export` | Export report (body: `{format: 'pdf'\|'xlsx', params}`) | VIEW_REPORTS |
| GET | `/api/dashboards` | List (theo scope user thấy) | — |
| POST | `/api/dashboards` | Tạo dashboard | MANAGE_DASHBOARD |
| GET | `/api/dashboards/:id` | Chi tiết + widgets | — |
| PATCH | `/api/dashboards/:id` | Update meta + layout | owner/MANAGE |
| DELETE | `/api/dashboards/:id` | Xóa | owner/MANAGE |
| POST | `/api/dashboards/:id/widgets` | Thêm widget | owner/MANAGE |
| PATCH | `/api/dashboards/:id/widgets/:wid` | Update config/position | owner/MANAGE |
| DELETE | `/api/dashboards/:id/widgets/:wid` | Xóa widget | owner/MANAGE |
| GET | `/api/widgets/:wid/data` | Lấy data render widget (dispatch theo type) | VIEW_REPORTS |
| POST | `/api/dashboards/:id/export` | Export cả dashboard ra PDF | VIEW_REPORTS |

DTO ví dụ (class-validator):
```typescript
export class BurndownQueryDto {
  @IsString() sprintId: string;
  @IsIn(['points', 'count']) @IsOptional() unit: 'points' | 'count' = 'points';
}
```

---

## 6. Dashboard tùy biến

### 6.1. Layout grid (FE: `react-grid-layout`)

- `Dashboard.layout` lưu mảng `{ i, x, y, w, h, minW, minH }` (12-column grid). `i` = `widget.id`.
- Kéo-thả / resize → debounce 500ms → `PATCH /api/dashboards/:id` cập nhật cả `layout` và `widget.position`.
- Responsive: `react-grid-layout` ResponsiveGridLayout với breakpoints `lg/md/sm` → mobile xếp 1 cột.

### 6.2. Widget config theo loại

```typescript
type WidgetConfig =
  | { type: 'BURNDOWN'; sprintId: string; unit: 'points'|'count' }
  | { type: 'VELOCITY'; projectId: string; boardId: string; last: number }
  | { type: 'CFD'; boardId: string; rangeDays: number; granularity: 'day'|'week' }
  | { type: 'SPRINT_REPORT'; sprintId: string }
  | { type: 'CONTROL_CHART'; boardId: string; rangeDays: number; metric: 'cycle'|'lead' }
  | { type: 'CREATED_VS_RESOLVED'; projectId: string; rangeDays: number; jql?: string }
  | { type: 'STAT_NUMBER'; jql: string; label: string; compareRangeDays?: number }
  | { type: 'ISSUE_LIST'; jql: string; columns: string[]; limit: number }
  | { type: 'PIE_BY_FIELD'; jql: string; groupBy: 'assignee'|'type'|'priority'|'status' }
  | { type: 'AI_INSIGHT'; sourceReport: WidgetType; params: Record<string, unknown> };
```

- `GET /api/widgets/:wid/data` đọc `widget.config`, dispatch sang report service tương ứng → trả đúng shape recharts. Widget không lưu data, chỉ lưu config (single source of truth).
- `STAT_NUMBER`, `ISSUE_LIST`, `PIE_BY_FIELD` gọi sang **Search subsystem (JQL)** để lấy issue set, rồi aggregate.
- `AI_INSIGHT`: lấy data report nền → POST sang AI subsystem → render text insight. Lỗi/thiếu key → render fallback "AI insights unavailable" + vẫn show data nền.

---

## 7. Export PDF / Excel

### 7.1. Thư viện đề xuất

| Loại | Thư viện | Lý do |
|------|----------|-------|
| **Excel** | `exceljs` | Thuần Node, stream được, format cell/sheet phong phú, không cần binary ngoài. |
| **PDF (report đơn)** | `pdfkit` + `@nestjs/...` hoặc render chart server-side bằng `chartjs-node-canvas` | Nhẹ, kiểm soát layout; vẽ chart thành PNG nhúng vào PDF. |
| **PDF (dashboard / WYSIWYG)** | `puppeteer-core` + Chromium (Docker) | Render đúng những gì người dùng thấy (recharts SVG) → screenshot/print-to-PDF. Đặt sau service riêng vì nặng. |

> **Khuyến nghị triển khai**: Excel dùng `exceljs` (raw data + computed). PDF báo cáo đơn dùng `pdfkit` + `chartjs-node-canvas` (chart server-side, tránh phụ thuộc Chromium). PDF "export cả dashboard" mới dùng Puppeteer (route `/print/dashboard/:id?token=` render headless).

### 7.2. Luồng & async

- Export nhỏ (1 report) → **synchronous**, trả file stream `Content-Disposition: attachment`.
- Export lớn / dashboard → **job nền** (BullMQ + Redis): `POST` trả `{ jobId }`; client poll `GET /api/exports/:jobId` hoặc nhận WS `export:ready { url }`. File lưu tạm (S3/MinIO hoặc local volume) với pre-signed URL TTL 1h.

```typescript
@Injectable()
export class ExportService {
  async toExcel(reportType: string, params: any): Promise<Buffer> {
    const data = await this.reports.dispatch(reportType, params);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(reportType);
    ws.columns = inferColumns(data);            // map shape → cột
    data.series?.forEach((r) => ws.addRow(r));
    return wb.xlsx.writeBuffer() as Promise<Buffer>;
  }
}
```

---

## 8. Frontend (React + recharts + TanStack Query)

```
frontend/src/features/analytics/
├── api/reports.api.ts          // axios + react-query hooks
├── hooks/useReportQuery.ts     // useQuery(['report', type, params])
├── charts/                     // 1 component / report, dùng recharts
│   ├── BurndownChart.tsx       // ComposedChart
│   ├── VelocityChart.tsx       // BarChart grouped
│   ├── CfdChart.tsx            // stacked AreaChart
│   ├── ControlChart.tsx        // ScatterChart + ReferenceLine
│   └── CreatedVsResolvedChart.tsx
├── dashboard/
│   ├── DashboardCanvas.tsx     // ResponsiveGridLayout
│   ├── WidgetRenderer.tsx      // switch theo widget.type
│   ├── WidgetConfigDialog.tsx
│   └── AddWidgetMenu.tsx
└── export/ExportButton.tsx
```

- **Query keys** chuẩn hóa: `['report', type, normalizedParams]`. Realtime `report:invalidate` → `queryClient.invalidateQueries({ queryKey: ['report', t, ...] })` cho live burndown/CFD.
- **Loading/empty/error**: skeleton chart; sprint chưa có data → empty state; lỗi AI widget → fallback badge.
- **Dark mode**: dùng CSS vars cho màu recharts (`stroke="var(--chart-1)"`), nhất quán với theme shadcn.
- Ví dụ BurndownChart:
```tsx
<ComposedChart data={data.series}>
  <XAxis dataKey="date" /><YAxis />
  <Area dataKey="remaining" fill="var(--chart-1)" stroke="var(--chart-1)" />
  <Line dataKey="ideal" stroke="var(--muted-foreground)" strokeDasharray="4 4" dot={false} />
  <Tooltip /><Legend />
</ComposedChart>
```

---

## 9. Hiệu năng & pre-aggregation (chiến lược)

1. **Snapshot khi đóng sprint** (`SprintSnapshot`): Velocity & Sprint report đọc trực tiếp, O(1), không bao giờ scan history. Đây là pre-aggregation quan trọng nhất.
2. **ReportCache với TTL phân tầng**:
   - Sprint/board **đang mở** (live): TTL 60s + invalidate chủ động khi có `issue.changed`.
   - Scope **đã đóng**: TTL dài (24h) hoặc vĩnh viễn (history bất biến).
3. **Index** đã đặt trên `IssueHistory` theo `(sprintId, field, occurredAt)`, `(projectId, field, occurredAt)`, `(projectId, newCategory, occurredAt)` — phủ mọi truy vấn báo cáo.
4. **Reconstruct state hiệu quả**: CFD/control chart duyệt history **một lần** theo `occurredAt`, giữ map in-memory `issueId→state`, emit snapshot theo bucket — tránh N truy vấn/ngày.
5. **Daily rollup (tùy chọn scale)**: cron `@Cron` nightly materialize CFD theo ngày vào `ReportCache` cho khoảng đã đóng → query chỉ append phần "live".
6. **createMany** cho ingest history (batch), tránh chèn từng dòng.
7. Cân nhắc **partition `IssueHistory` theo `projectId`/tháng** khi dữ liệu lớn (PostgreSQL declarative partitioning) — ghi rõ là tối ưu giai đoạn sau, không bắt buộc cho MVP.

---

## 10. Seed data (yêu cầu "chạy được + có data")

- Seed 2 project, mỗi project 3–4 sprint (2 đã `CLOSED`, 1 đang `ACTIVE`, 1 `FUTURE`).
- Sinh `IssueHistory` **giả lập theo thời gian thực** trong sprint window (rải `occurredAt` qua các ngày) để Burndown/CFD/Control chart có hình dạng thật, không phẳng.
- Chạy `SnapshotService.closeSprint()` cho các sprint CLOSED → có `SprintSnapshot` cho Velocity.
- Seed 1 default Dashboard/project với các widget: Burndown (sprint active), Velocity, CFD, Created-vs-Resolved, 1 STAT_NUMBER (open bugs).

---

## 11. Testing

- **Unit**: từng report service với fixture `IssueHistory` cố định → assert series (đặc biệt edge cases: scope change giữa sprint, reopen issue, weekend ideal line flat, issue không có story points).
- **Integration**: event `issue.changed` → `IssueHistory` ghi đúng → endpoint trả shape đúng. Đóng sprint → `SprintSnapshot` đúng committed/completed.
- **Contract test**: shape DTO khớp `packages/shared` types (FE/BE).
- **Export**: snapshot test buffer Excel có đúng số sheet/cột; PDF smoke test (non-empty buffer).
- **Graceful degrade**: mock AI subsystem trả 503 → widget AI_INSIGHT vẫn render data nền.