# Tirapro — Danh sách chức năng theo Actor

> Mô hình quyền 2 cấp scope (kế thừa `docs/MASTER_PLAN.md` §4.2): quyền hiệu lực =
> **union(vai trò Workspace, vai trò Project)**. Một người có 1 vai trò ở workspace và có thể
> có vai trò khác nhau ở từng project. Mọi tính năng "nâng cấp" (AI, realtime, analytics)
> **degrade gracefully** — thiếu hạ tầng vẫn dùng được phần lõi.

## 1. Các Actor & ánh xạ persona

| Actor (vai trò hệ thống) | Scope | Persona thực tế |
|---|---|---|
| **System Admin** (`isSystemAdmin`) | Toàn nền tảng | Chủ hệ thống self-hosted / ops |
| **Workspace Admin** | Workspace (tenant) | Trưởng phòng, org admin |
| **Workspace Member** | Workspace | Nhân viên chính thức |
| **Workspace Viewer** | Workspace | Khách nội bộ, sếp chỉ xem |
| **Project Admin (Lead)** | 1 Project | Project Manager / Scrum Master |
| **Project Developer** | 1 Project | Developer, QA, Designer |
| **Project Reporter** | 1 Project | Stakeholder, CS, người báo bug |
| **Guest / Anonymous** | — | Chưa đăng nhập |

---

## 2. Chức năng theo từng Actor

### 2.0 Guest / Anonymous (chưa đăng nhập)
- Đăng ký tài khoản, đăng nhập, quên/đặt lại mật khẩu.
- (Tùy chọn) xem qua **public share link** ở chế độ chỉ đọc.

### 2.1 Mọi người dùng đã đăng nhập (cross-cutting — actor nào cũng có)
- Quản lý hồ sơ cá nhân (tên, avatar, timezone, locale), đổi mật khẩu, đăng xuất (thu hồi refresh token).
- Chuyển đổi giữa nhiều workspace mình là thành viên.
- Trung tâm **thông báo** (in-app realtime + đánh dấu đã đọc), **watch/unwatch** issue.
- **Command palette (Cmd+K)**: điều hướng nhanh, nhảy tới issue/project, chạy hành động bằng phím tắt.
- Đổi **theme sáng/tối**, tìm kiếm nhanh, saved filter **cá nhân**, dashboard **cá nhân**.
- Hồ sơ hoạt động của bản thân (issue được giao, đã báo, đang theo dõi).

### 2.2 System Admin
> Bao trùm mọi quyền dưới đây, xuyên workspace.
- Quản lý toàn bộ workspace, người dùng nền tảng (khóa/mở, cấp lại mật khẩu).
- Cấu hình hệ thống, hạn ngạch AI theo workspace, xem log vận hành (`AiGenerationLog`).
- Seed dữ liệu mẫu, bảo trì, xem health/metrics.

### 2.3 Workspace Admin
- Tạo / sửa / lưu trữ / xóa **project** trong workspace.
- **Quản lý thành viên workspace**: mời, gỡ, gán vai trò workspace cho từng người.
- Tạo & quản lý **vai trò tùy biến** và gán bộ quyền (RBAC).
- Cấu hình workspace (tên, slug, settings, gói plan).
- Quản lý **custom field cấp workspace**, **issue types**.
- Tạo & chia sẻ **dashboard toàn workspace**, **saved filter** chia sẻ.
- Toàn quyền nội dung của mọi project (kế thừa quyền Project Admin ở tất cả project).

### 2.4 Workspace Member
- Xem danh sách project mình tham gia; được mời/thêm vào project.
- Tạo project mới (**nếu** được cấp quyền `project:create`).
- Trong project mình tham gia: thao tác theo **vai trò project** tương ứng.
- Dùng **AI**, tạo saved filter & dashboard cá nhân, semantic search.

### 2.5 Workspace Viewer
- **Chỉ đọc** trên các project được phép: xem board, backlog, issue, comment, report, dashboard.
- Không tạo/sửa/xóa bất cứ thứ gì; không dùng hành động ghi của AI (chỉ xem tóm tắt nếu được chia sẻ).

### 2.6 Project Admin (Lead) — trong phạm vi 1 project
- Cấu hình project: **board** (cột ↔ status, WIP, swimlane), **workflow** (status + transition), **custom field** cấp project, label/component/version.
- Quản lý **thành viên project** & gán vai trò project.
- **Sprint**: tạo, start, complete (sinh snapshot báo cáo), xóa.
- Mọi thao tác issue: tạo/sửa/xóa, transition bất kỳ, gán, liên kết, di chuyển.
- Quản lý backlog, xóa comment của bất kỳ ai, cấu hình thông báo project.
- Trợ lý **AI sprint planning**, xem mọi report của project.

### 2.7 Project Developer — trong phạm vi 1 project
- **Issue**: tạo, sửa (mọi issue trong project), **chuyển trạng thái** theo workflow, **gán** người, đặt story points/estimate, **liên kết** issue, tạo sub-task/epic link.
- **Board**: kéo-thả card giữa các cột (realtime + optimistic), lọc/nhóm.
- **Backlog**: xếp ưu tiên (rank), kéo issue vào/ra sprint (nếu có `backlog:manage`).
- **Comment** + @mention, đính kèm file, **log work** (worklog).
- Dùng **AI**: sinh issue từ NL, tóm tắt, gợi ý assignee/priority/points; semantic search.
- Xem report, presence realtime (ai đang xem issue).

### 2.8 Project Reporter (Stakeholder) — trong phạm vi 1 project
- **Tạo issue** (báo bug/yêu cầu), sửa **issue do mình tạo/được giao** (`issue:edit:own`).
- **Comment** + @mention, đính kèm file, watch issue.
- Xem board, backlog, issue, **report** (chỉ đọc).
- (Tùy quyền) dùng AI tóm tắt/sinh mô tả issue mình tạo.
- Không transition tự do, không cấu hình project, không xóa issue của người khác.

---

## 3. Ma trận quyền — phạm vi Workspace

Chú thích: ✅ toàn quyền · 👁 chỉ xem · ➖ không có · ⚙️ tùy cấp quyền `project:create`.

| Hành động | Sys Admin | WS Admin | WS Member | WS Viewer |
|---|:---:|:---:|:---:|:---:|
| Xem workspace & project được phép | ✅ | ✅ | ✅ | 👁 |
| Tạo project | ✅ | ✅ | ⚙️ | ➖ |
| Lưu trữ / xóa project | ✅ | ✅ | ➖ | ➖ |
| Mời / gỡ thành viên workspace | ✅ | ✅ | ➖ | ➖ |
| Tạo vai trò & gán quyền (RBAC) | ✅ | ✅ | ➖ | ➖ |
| Cấu hình workspace (settings/plan) | ✅ | ✅ | ➖ | ➖ |
| Custom field / issue type cấp workspace | ✅ | ✅ | ➖ | ➖ |
| Dashboard toàn workspace | ✅ | ✅ | ➖ | 👁 |
| Saved filter / dashboard cá nhân | ✅ | ✅ | ✅ | 👁 |
| Dùng AI (ai:use) | ✅ | ✅ | ✅ | ➖ |
| Quản trị nền tảng (đa workspace) | ✅ | ➖ | ➖ | ➖ |

---

## 4. Ma trận quyền — phạm vi Project

Chú thích: ✅ mọi issue · 🔵 chỉ của mình/được giao · 👁 chỉ xem · ➖ không.
Cột Viewer = Workspace Viewer (đối chiếu read-only).

| Hành động | Proj Admin | Developer | Reporter | Viewer |
|---|:---:|:---:|:---:|:---:|
| Xem project / board / issue / report | ✅ | ✅ | ✅ | 👁 |
| Tạo issue | ✅ | ✅ | ✅ | ➖ |
| Sửa issue | ✅ | ✅ | 🔵 | ➖ |
| Xóa issue | ✅ | ➖ | ➖ | ➖ |
| Chuyển trạng thái (transition) | ✅ | ✅ | 🔵 | ➖ |
| Gán assignee | ✅ | ✅ | ➖ | ➖ |
| Liên kết / sub-task / epic | ✅ | ✅ | ➖ | ➖ |
| Comment + @mention | ✅ | ✅ | ✅ | ➖ |
| Sửa/xóa comment | ✅ | 🔵 | 🔵 | ➖ |
| Đính kèm file / log work | ✅ | ✅ | 🔵 | ➖ |
| Kéo-thả board | ✅ | ✅ | ➖ | ➖ |
| Quản lý board (cột/WIP/swimlane) | ✅ | ➖ | ➖ | ➖ |
| Quản lý backlog (rank, vào sprint) | ✅ | ⚙️ | ➖ | ➖ |
| Quản lý sprint (start/complete) | ✅ | ➖ | ➖ | ➖ |
| Sửa workflow / status / transition | ✅ | ➖ | ➖ | ➖ |
| Custom field cấp project | ✅ | ➖ | ➖ | ➖ |
| Quản lý thành viên project | ✅ | ➖ | ➖ | ➖ |
| Cấu hình / xóa project | ✅ | ➖ | ➖ | ➖ |
| AI: sinh/tóm tắt/gợi ý trong project | ✅ | ✅ | 🔵 | ➖ |
| AI: sprint planning assistant | ✅ | ➖ | ➖ | ➖ |

---

## 5. Tính năng nâng cấp — actor nào dùng

| Nhóm | Tính năng | Actor sử dụng |
|---|---|---|
| **AI** | Sinh issue từ ngôn ngữ tự nhiên | Developer, Project Admin (Reporter: cho issue của mình) |
| | Tóm tắt issue + thread comment | Mọi người xem được issue + có `ai:use` |
| | Gợi ý assignee / priority / story points | Developer, Project Admin |
| | Sprint planning assistant | Project Admin / Scrum Master |
| | Semantic search | Mọi người xem được project |
| **Realtime** | Board/issue cập nhật tức thời, presence, typing | Mọi người đang xem board/issue (theo quyền view) |
| **Analytics** | Burndown / Velocity / CFD / Sprint report | Reporter trở lên (xem); Project Admin (cấu hình) |
| | Dashboard tùy biến + widget | Member tạo cá nhân; WS Admin tạo toàn workspace |
| | Export PDF / Excel | Reporter trở lên |
| **UX** | Command palette (Cmd+K), phím tắt, dark mode, PWA | Mọi người dùng đã đăng nhập |

---

## 5b. Tích hợp (Integrations) — config-driven

| Tính năng | Mô tả | Actor cấu hình | Actor dùng |
|---|---|---|---|
| **Migration từ Jira** | Import projects/issues/comments/attachments từ Jira Cloud (REST API) hoặc file CSV/JSON; map issue type/status/priority → config Tirapro; chạy nền có tiến độ. | Workspace Admin (`import:run`) | — |
| **Telegram — thông báo** | Đẩy issue assigned / mention / đổi trạng thái / comment vào chat theo subscription. Bot toàn cục hoặc BYO token/workspace. | WS Admin (`integration:manage`) đặt bot; mỗi user `/link` chat cá nhân | Mọi user đã link |
| **Telegram — tạo task** | `/newtask` tạo issue từ chat (chọn project/type/summary/assignee). | — | Member+ (theo quyền project) |
| **Telegram — log bug** | `/bug` form hướng dẫn chọn field (steps, severity, environment...) theo cấu hình. | Project Admin định field set | Reporter+ |
| **Báo cáo / digest** | `ReportSubscription`: chọn **metric blocks** cần tổng hợp + lịch (daily/weekly/sprint-end) → gửi Telegram/email; `/report` lấy nhanh. | Project Admin / WS Admin (`digest:manage`) | Người nhận |

Secrets tích hợp (bot token, Jira API token) **mã hóa AES-256-GCM** trước khi lưu `Integration.config`. Tất cả degrade gracefully: thiếu cấu hình → tính năng tắt êm, app vẫn chạy.

## 6. Ghi chú & giả định
- Vai trò **kết hợp**: ví dụ một WS Member là Project Admin ở project A nhưng Developer ở project B.
- `issue:edit:own` (Reporter) = chỉ sửa issue do mình tạo hoặc được giao; quyền này kiểm tra ownership runtime (CASL).
- System role được seed sẵn; WS Admin có thể tạo role tùy biến và trộn quyền.
- Public share link là tính năng tùy chọn (Phase hoàn thiện), mặc định tắt.
- Mọi hành động ghi đều ghi **ActivityLog**; thay đổi trạng thái/điểm/sprint ghi **IssueHistory** (nguồn cho report).
