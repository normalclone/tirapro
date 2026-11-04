# Personal scope (cross-workspace overview + personal filters) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user who belongs to several workspaces gets a personal overview (`/me`) and personal saved filters / cross-workspace JQL that span every project they can see, without switching workspace.

**Architecture:**
- New `/me/*` API endpoints that are **not** workspace-scoped. They enumerate the user's active workspace memberships and call the existing `SearchService.search(workspaceId, userId, …)` per workspace, so RBAC/private-project rules apply unchanged. Results are merged with a composite cursor.
- `SavedFilter` gets `scope` (`WORKSPACE` | `PERSONAL`); PERSONAL rows have `workspaceId = null`.
- Web: a new route `/me` and a scope toggle plus a "Cá nhân" group on the Filters page. Opening an issue from another workspace switches workspace first.

**Tech Stack:** NestJS + Prisma, zod, React + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-personal-scope-design.md` (read whole).

**Branch:** `feat/personal-scope` in `/Users/inrnee/tirapro-wt/me`, off `fix/review-findings` @ 97de541a. Runs in parallel with `feat/workflow-per-type`, so keep changes inside the files listed here where possible.

## Global Constraints
- Never bypass RBAC: per workspace, reuse the same visibility logic the workspace-scoped search uses (`SearchService.buildWhere` / project-view checks). A private project the user isn't a member of must never appear.
- Workspaces counted: memberships whose workspace is not archived or deleted.
- Every result item carries `workspace: { id, name }`. The list envelope is `{success, data, pageInfo, meta}`.
- Unknown JQL value in some workspaces means those workspaces return 0 rows. If the value is unknown in **all** of them, return the same 422 error shape the workspace search returns.
- The new JQL field `workspace` (`=`, `!=`, `in`, `not in`, by name, case-insensitive) is valid only in personal scope. In workspace scope it returns 422 `FIELD_NOT_ALLOWED_IN_SCOPE`.
- Page limit is 200, and the cursor is opaque base64 JSON `{ wsCursors: Record<wsId, string|null> }`.
- Vietnamese UI copy. Error codes are `SCREAMING_SNAKE`. Gates: `pnpm lint` 0 errors, typecheck, tests, `format:check`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UyXyiG8CW8csVM5RoBsjjU`. Add paths explicitly, and never use `git commit -a`.

## Review Focus
1. A user in workspace A only must get exactly the same results from `/me/search` as from the workspace search in A.
2. A private project in workspace B where the user isn't a member must never leak, and neither may an archived workspace.
3. Sorting and pagination across workspaces: there are no duplicates or gaps when paging through 3 pages, and the order is stable by `(sortKey, id)`.
4. A PERSONAL saved filter must not be visible to other users, or listed under any workspace's filters.
5. Clicking a foreign-workspace issue must switch workspace and open the issue. Pressing Back must not leave the app in a half-switched state.

---

> **Cập nhật 2026-11-05:** người dùng bỏ khái niệm workspace (sẽ đổi thành Công ty ở đợt riêng). Phần xuyên workspace (Task 1 cũ) đã revert ở 57d1d34f; bộ lọc cá nhân không làm (bộ lọc PRIVATE hiện có đã là "cá nhân"). Đợt này chỉ còn **trang Tổng quan cá nhân `/me`** trong phạm vi công ty (workspace) hiện tại. Các ràng buộc "xuyên workspace" ở trên không còn áp dụng; các ràng buộc RBAC vẫn áp dụng.

### Task 2: API — `/me/overview`
- **Files:** create `apps/api/src/modules/me/{me.module.ts, me.controller.ts, me-overview.service.ts}` (+ spec); đăng ký module.
- **Produces:** `GET /me/overview` (theo workspaceId trong JWT, như mọi API khác) trả về:
  ```
  {
    counts: {open, overdue, dueSoon, donePointsThisWeek},
    myIssues: Item[] (chưa xong, assignee = tôi, sắp theo dueDate tăng dần nulls last, rồi priority giảm dần; tối đa 50),
    bugs: { awaitingRetest: Item[], reopened: Item[], assignedToMe: Item[] },
    weeklyDonePoints: { weekStart: string, byProject: {projectKey, points}[] }[] (8 tuần, chỉ tính việc lá theo quy tắc điểm hiện có)
  }
  ```
  Item = IssueDto rút gọn + `projectKey`, `status {id,name,category}`, `points`, `dueDate`.
- **Khớp trạng thái:** awaitingRetest = tên `Ready for Retest`, HOẶC trạng thái nhóm IN_PROGRESS có tên chứa "test" (không phân biệt hoa/thường/dấu). Reopened = tên `Reopened` / "Mở lại". Cả hai chỉ đếm bug **do tôi báo** (`reporterId` = tôi).
- **Tuần** theo giờ VN (Asia/Ho_Chi_Minh), bắt đầu thứ Hai. overdue/dueSoon theo ngày VN (dueSoon = trong 7 ngày tới, không gồm quá hạn).
- **RBAC:** chỉ dự án tôi xem được (dùng lại bộ lọc khả kiến dự án của search/issues — không tự viết lại luật).
- **Tests:** counts; sắp xếp myIssues; chỉ tính việc lá; heuristic retest/reopened; dự án riêng tư không là thành viên thì không lộ; ranh giới tuần VN.

### Task 4: Web — trang `/me`
- **Files:** create `apps/web/src/features/me/{api.ts, MeOverviewPage.tsx}` (+ test); route `/me` trong `app/router.tsx`; mục thanh bên "Của tôi" (icon `UserRound`, ngay trên "Tổng quan").
- **UI:** ô số; danh sách "Việc của tôi" (chip dự án, `StatusPill alwaysShowName`, điểm, hạn dạng ngày `formatCalendarDmy`, chip lọc nhanh theo dự án); tab "Bug liên quan đến tôi"; biểu đồ cột chồng điểm theo tuần (dùng thư viện/chart component sẵn có — grep `features/reports`); empty state; bám DESIGN.md + UX_CONVENTIONS. Bấm việc → mở `/issue/:key`.
- **Tests:** render dữ liệu nhiều dự án kèm chip; lọc theo chip dự án; bấm việc điều hướng đúng; empty state.

### Task 5: Chia sẻ bộ lọc theo dự án + người cụ thể (người dùng chốt 2026-11-05)
- **Quyết định người dùng:** bỏ lựa chọn "Cả không gian làm việc". Một bộ lọc chia sẻ được cho **nhiều dự án** (thành viên dự án thấy) **và** cho **từng người cụ thể**, cùng lúc. Vẫn có "Chỉ mình tôi" (không chia sẻ). Bộ lọc đang ở mức WORKSPACE (prod có 1) → chuyển thành chia sẻ cho **mọi dự án sống mà chủ bộ lọc là thành viên**.
- **Schema + migration:** bảng nối `SavedFilterProjectShare(filterId, projectId)` và `SavedFilterUserShare(filterId, userId)` (PK ghép, cascade khi xoá filter/project/user, index theo projectId/userId). Enum `FilterVisibility` còn `PRIVATE | SHARED` (SHARED khi có ít nhất 1 share). Migration SQL chuyển dữ liệu: PROJECT+sharedProjectId → 1 dòng project share; WORKSPACE → project share cho mọi ProjectMember sống của owner trong workspace đó; rồi bỏ cột `sharedProjectId` và giá trị enum cũ. Migration phải chạy được trên prod hiện tại (9 PRIVATE, 1 WORKSPACE). `pnpm gen:enums`.
- **Quy tắc xem:** owner; người có user share; thành viên (xem được) của bất kỳ dự án được share. Kết quả chạy vẫn theo quyền người xem (giữ nguyên). SA/Workspace Admin không tự động thấy bộ lọc riêng tư của người khác.
- **Quy tắc chia sẻ:** chỉ owner sửa chia sẻ. Chỉ share được cho dự án mà owner xem được; người được share phải là thành viên tổ chức (WorkspaceMembership) — sai thì 422 mã rõ ràng. Mỗi người mới được share nhận 1 thông báo ("X đã chia sẻ bộ lọc Y với bạn") qua hệ thống notification sẵn có.
- **API:** cập nhật DTO/zod trong `packages/shared`: `{ visibility, sharedProjectIds: string[], sharedUserIds: string[] }`; GET trả về danh sách dự án/người được share (id, tên). Danh sách bộ lọc trả kèm `access: 'owner' | 'shared'`. Grep mọi nơi dùng `sharedProjectId`/`FilterVisibility.WORKSPACE`/`PROJECT` (boards, dashboards gadget, automation, assistant…) và chuyển sang mô hình mới.
- **Web:** hộp "Chia sẻ bộ lọc": radio "Chỉ mình tôi" / "Chia sẻ"; khi Chia sẻ: chọn nhiều dự án + chọn nhiều người (tìm theo tên/email, có avatar); khối "Ai có quyền xem" tổng hợp số người (hợp các thành viên dự án + người cụ thể, không đếm trùng). Rail trang Bộ lọc nhóm "Của tôi" / "Được chia sẻ với tôi" (ghi chủ sở hữu). Không dùng chữ "workspace"/"không gian làm việc" trong copy mới; nếu cần nói tới cấp trên dự án thì dùng "tổ chức".
- **Tests:** migration (int, PG thật) với dữ liệu PRIVATE/PROJECT/WORKSPACE; quyền xem (owner / user share / project share / người ngoài không thấy / mất quyền dự án thì không thấy); chỉ owner sửa share; 422 khi share cho người ngoài tổ chức hoặc dự án owner không xem được; thông báo chỉ gửi người mới thêm; web: dialog chọn nhiều + đếm người không trùng, rail hai nhóm.

### Task 6: Final review + merge + deploy
- Review toàn nhánh; deploy bằng `deploy.sh` (có backup); kiểm bằng tài khoản phucnv, chụp `/me` gửi Telegram.
