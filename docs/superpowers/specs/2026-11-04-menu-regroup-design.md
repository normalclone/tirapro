# Gộp menu "Danh mục" vào các chức năng liên quan — thiết kế

Ngày: 2026-11-04 · Người dùng chốt (kèm ảnh màn Danh mục → Mục tiêu).

## Vì sao
Mục "Danh mục" (`/manage`) gom 6 màn cấp tổ chức: Danh mục dự án, Mục tiêu, Rủi ro & vướng mắc, Nhân lực, Thời gian xử lý, Khách hàng. Người dùng muốn mỗi thứ nằm đúng chỗ người ta tìm nó, và bỏ những gì không dùng.

## Quyết định của người dùng
| Chức năng | Về đâu |
|---|---|
| Danh mục dự án (nhóm dự án = `Program`) | Trang **Dự án**. Một dự án thuộc được **nhiều nhóm**: danh sách dự án có trường **"Nhóm"** hiện số nhóm, bấm vào mở **popup liệt kê các nhóm** đó. Có chế độ xem **theo cây/thư mục** (nhóm → dự án). |
| Mục tiêu | **Theo dự án** (tab trong dự án) |
| Rủi ro & vướng mắc | **Theo dự án** (tab trong dự án) |
| Nhân lực | Gom vào **Thành viên** (một tab) |
| Thời gian xử lý (SLA) | Gom vào **dự án**, **chỉ cấp dự án** (không có mặc định tổ chức) |
| Khách hàng | **Bỏ** |

Sau khi chuyển: mục "Danh mục" biến mất khỏi thanh bên, Cmd+K, trợ lý, tài liệu.

## Hành vi
### Nhóm dự án
- Dữ liệu: quan hệ nhiều–nhiều Dự án ↔ Nhóm. Dữ liệu hiện có (`Project.programId`, prod: 3 nhóm, 8 dự án gán) được chuyển nguyên sang quan hệ mới rồi bỏ cột cũ.
- Danh sách dự án: cột "Nhóm" — `N nhóm` (0 → "—"). Bấm → popover: danh sách nhóm của dự án (màu + tên); người có quyền quản trị dự án (hoặc quản trị chung) thêm/bớt nhóm ngay trong popover (chọn nhiều, tìm theo tên, tạo nhóm mới tại chỗ nếu có quyền quản lý nhóm).
- Chế độ xem: công tắc **"Danh sách / Theo nhóm"** (nhớ lựa chọn theo người dùng, localStorage có try/catch). "Theo nhóm" = cây thu gọn được: mỗi nhóm một nút (màu, tên, số dự án), con là dự án; dự án thuộc nhiều nhóm hiện dưới từng nhóm; cuối cùng "Chưa thuộc nhóm". Lọc/tìm/sắp xếp/hiện đã lưu trữ áp cho cả hai chế độ.
- Quản lý nhóm (tạo/đổi tên/màu/xoá) ở nút "Quản lý nhóm" trên trang Dự án (dialog), quyền như API hiện có của Program.
### Mục tiêu, Rủi ro & vướng mắc
- Thành tab trong dự án (`/p/:key/goals`, `/p/:key/risks`), dùng lại màn hiện có với dự án cố định (bỏ bộ lọc dự án). Tạo mới luôn gắn dự án hiện tại. API bắt buộc `projectId` khi tạo (prod: 2 mục tiêu đều đã có dự án; 0 rủi ro). Quyền theo quyền dự án hiện có của các màn này.
### Nhân lực
- Tab "Nhân lực" trong trang Thành viên (dùng lại màn hiện có). Quyền xem giữ như hiện tại của màn Nhân lực; trang Thành viên đang ẩn với người không quản lý thành viên — tab Nhân lực đi theo trang.
### Thời gian xử lý (SLA)
- Thành mục trong **Cấu hình dự án** (`/p/:key/config/response-time` hoặc tên section phù hợp) + bảng theo dõi SLA của dự án. Chính sách SLA bắt buộc `projectId` (prod: 0 chính sách). Bỏ chính sách cấp tổ chức.
### Khách hàng
- Bỏ màn, route, API module, mục trợ lý/tài liệu. Dữ liệu prod 0 khách hàng, 0 hợp đồng, 0 dự án gắn khách hàng → bỏ luôn bảng/cột (`Client`, `Contract` nếu chỉ phục vụ khách hàng, `Project.clientId`) bằng migration.
### Đường dẫn cũ
- `/manage/*` và các redirect cũ (`/portfolio`, `/goals`, `/raid`, `/resources`, `/sla`, `/clients`) chuyển hướng: portfolio → `/projects?view=groups`; goals/risks/response-time → `/projects` (kèm toast/ghi chú "Mục tiêu giờ nằm trong từng dự án"); resources → `/members?tab=resources`; clients → `/projects`.

## Ràng buộc
- `CLAUDE.md`, DESIGN.md, UX_CONVENTIONS.md. Copy dùng "tổ chức", không "workspace"/"không gian".
- Migration chạy được trên dữ liệu prod hiện tại; deploy có backup.
