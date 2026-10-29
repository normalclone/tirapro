# 00. Tổng quan

[← Về mục lục](README.md)

## 1. Giới thiệu và mục đích

Tirapro là hệ thống quản lý công việc kiểu Jira dành cho đội nội bộ, bổ sung ba hướng nâng cấp: **AI** (sinh/tóm tắt/gợi ý công việc), **realtime** (board, issue cập nhật tức thời) và **analytics** (báo cáo sprint, dashboard, sức khoẻ dự án). Người dùng là đội nội bộ, giao diện tiếng Việt. Ưu tiên số 1 của sản phẩm là **thuận tiện, dễ dùng** (`docs/UX_CONVENTIONS.md`).

Bộ SRS này mô tả hành vi của hệ thống ở mức đủ để BA/Dev/QA cùng hiểu một nghĩa; không thay thế OpenAPI (`/api/docs`) hay wireframe.

## 2. Phạm vi

**Trong phạm vi:** quản lý workspace/dự án/công việc, workflow và board, sprint/backlog, tìm kiếm (JQL), thông báo, báo cáo, nhập/xuất dữ liệu, tích hợp (Telegram, digest, nhập từ Jira), phân quyền RBAC.

**Ngoài phạm vi (hiện tại):** kết nối Jira Cloud qua REST; xuất `.xlsx`/PDF phía máy chủ (chỉ xuất CSV/JSON); ứng dụng di động riêng.

## 3. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| Workspace | Một tenant (tổ chức). Mọi dữ liệu thuộc đúng một workspace; truy vấn luôn lọc theo `workspaceId` của request. |
| Dự án (Project) | Tập công việc trong workspace, có mã `key` (vd `DEMO`), workflow riêng, thành viên riêng. |
| Công việc (Issue) | Đơn vị làm việc; tiêu đề lưu ở trường `summary`. Mã dạng `DEMO-TASK-12`. |
| Việc chờ (Backlog) | Danh sách công việc chưa vào sprint. |
| Epic | Công việc cấp cao nhất, gom các công việc khác (`epicId`). |
| Sprint | Mốc lặp thời gian: sắp tới (`FUTURE`), đang chạy (`ACTIVE`), đã đóng (`CLOSED`). |
| Thành phần (Component) / Phiên bản (Version) / Nhãn (Label) | Danh mục theo dự án để phân loại công việc / mốc phát hành / gắn thẻ tự do. |
| RBAC | Quyền theo chuỗi `resource:action` (vd `import:run`), gán qua vai trò; quyền hiệu lực = hợp của vai trò workspace và vai trò dự án. |
| OCC | Optimistic concurrency control — trường `version` của issue, mọi cập nhật realtime phải gửi kèm. |
| ImportJob | Bản ghi một lần nhập dữ liệu (nguồn, trạng thái, tiến độ, kết quả). |
| Biểu mẫu Excel | Tệp `.xlsx` theo dự án có drop-list lấy từ cấu hình dự án, dùng để nhập công việc hàng loạt (xem [10](10-import-hang-loat.md)). |

## 4. Nhóm chức năng

Lấy từ `docs/FEATURES_BY_ACTOR.md`. Cột "Đặc tả" trỏ tới tài liệu chi tiết nếu đã có.

| # | Nhóm chức năng | Đặc tả |
|---|---|---|
| 1 | Xác thực và hồ sơ cá nhân (đăng ký, đăng nhập, quên mật khẩu, JWT + refresh, hồ sơ, theme) | Chưa đặc tả chi tiết |
| 2 | Quản trị hệ thống (workspace, người dùng nền tảng, hạn ngạch AI, health/metrics) | Chưa đặc tả chi tiết |
| 3 | Workspace, thành viên và phân quyền RBAC (vai trò hệ thống/tuỳ biến, nhật ký quản trị) | Chưa đặc tả chi tiết |
| 4 | Dự án và cấu hình dự án (thành phần, phiên bản, nhãn, quyền riêng tư, lưu trữ, mẫu dự án) | Chưa đặc tả chi tiết |
| 5 | Công việc (issue), workflow và trạng thái, trường tuỳ chỉnh | Chưa đặc tả chi tiết |
| 6 | Board, Việc chờ và sprint | Chưa đặc tả chi tiết |
| 7 | Tìm kiếm, JQL và bộ lọc đã lưu | Chưa đặc tả chi tiết |
| 8 | Thông báo, theo dõi (watch) và realtime | Chưa đặc tả chi tiết |
| 9 | AI (sinh issue, tóm tắt, gợi ý, sprint planning, tìm kiếm ngữ nghĩa) | Chưa đặc tả chi tiết |
| 10 | Báo cáo, dashboard và analytics (burndown, velocity, CFD, sức khoẻ dự án, OKR) | Chưa đặc tả chi tiết |
| 11 | **Nhập/xuất dữ liệu hàng loạt** (biểu mẫu Excel, CSV, JSON, xuất CSV/JSON) | [10-import-hang-loat.md](10-import-hang-loat.md) (nhập: chi tiết; xuất: chưa đặc tả) |
| 12 | Tích hợp (Telegram, digest/báo cáo định kỳ, nhập từ Jira) | Chưa đặc tả chi tiết (Jira: tóm lược ở tài liệu 10) |
| 13 | Wiki, rủi ro (RAID), nhân lực, Danh mục (portfolio) | Chưa đặc tả chi tiết |
| 14 | Command palette (Cmd+K), phím tắt, PWA | Chưa đặc tả chi tiết (lệnh "Nhập công việc từ Excel": xem tài liệu 10; lệnh "Hỏi trợ lý" và phím `g a`: xem tài liệu 11) |
| 15 | **Trợ lý Tirapro** (ô chat nổi, chế độ cơ bản: hỏi đáp theo màn hình, hướng dẫn, tra việc, soạn nháp tạo việc) | [11-tro-ly-chatbot.md](11-tro-ly-chatbot.md) |

## 5. Bối cảnh kỹ thuật

Monorepo pnpm + Turborepo.

| Thành phần | Công nghệ |
|---|---|
| `apps/api` | NestJS 10, Prisma, PostgreSQL (pgvector), Redis, Socket.io; cổng 4000, tiền tố `/api/v1` |
| `apps/web` | React 18, Vite, TypeScript, Tailwind, TanStack Query, Zustand; cổng 5173 |
| `packages/types` | `@tirapro/types` — enum (phản chiếu Prisma), danh mục quyền, tên sự kiện, DTO |
| `packages/shared` | `@tirapro/shared` — zod schema, hợp đồng WebSocket, ngữ pháp JQL, LexoRank |
| Lưu tệp đính kèm | MinIO / S3 (`STORAGE_DRIVER`, `S3_*`) hoặc thư mục cục bộ |
| Cache, throttle, presence | Redis — Redis ngừng thì REST vẫn chạy (degrade gracefully) |

Quy ước chốt: ID dạng CUID; phản hồi danh sách bọc `{success,data,pageInfo,meta}`, phản hồi đơn trả đối tượng thô; lỗi `{success:false,error:{code,message,statusCode},meta}` với `code` dạng `SCREAMING_SNAKE`; REST `api/v1/<số nhiều>`; auth = JWT access (giữ trong bộ nhớ ở FE) + refresh xoay vòng (cookie httpOnly).

## 6. Actor và vai trò

| Actor | Phạm vi | Ghi chú |
|---|---|---|
| System Admin | Toàn nền tảng | Bao trùm mọi quyền |
| Workspace Admin | Workspace | Toàn quyền nội dung mọi dự án |
| Workspace Member / Viewer | Workspace | Thành viên chính thức / chỉ xem |
| Project Admin (Lead) | Một dự án | PM / Scrum Master |
| Project Developer | Một dự án | Dev, QA, Designer |
| Project Reporter | Một dự án | Stakeholder, người báo lỗi |
| Khách (chưa đăng nhập) | — | Đăng ký/đăng nhập, xem liên kết chia sẻ |

Chi tiết quyền theo actor: `docs/FEATURES_BY_ACTOR.md`.

## 7. Ràng buộc chung

1. **Cô lập tenant:** mọi truy vấn theo `projectId`/`id` đều phải thuộc `workspaceId` của request; sai workspace trả 404 ("… không tồn tại"), không lộ sự tồn tại.
2. **Dự án lưu trữ là chỉ đọc:** mọi thao tác ghi bị chặn với thông báo "Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi".
3. **Phân quyền** bằng chuỗi `resource:action`; thiếu quyền trả 403.
4. **Ngày lịch** (hạn, ngày bắt đầu) lưu nửa đêm UTC `YYYY-MM-DDT00:00:00Z` và hiển thị `dd/mm/yyyy` — không lệch múi giờ.
5. **Tiếng Việt** cho mọi thông báo hướng người dùng; thuật ngữ thống nhất (công việc, Việc chờ, Bảng việc).
6. **Degrade gracefully:** thiếu `ANTHROPIC_API_KEY` thì AI dùng heuristic; thiếu Redis thì REST vẫn chạy; chưa chạy `db:raw` thì tìm văn bản rơi về `ILIKE`.
7. **Không ghi bí mật** (token, mật khẩu) vào mã nguồn hay tài liệu; bí mật tích hợp mã hoá AES-256-GCM trước khi lưu.
