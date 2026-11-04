# Bảng tổng quan: tạo từ mẫu + phạm vi dự án / nhóm dự án — thiết kế

Ngày: 2026-11-05. Người dùng yêu cầu: "các bảng tổng quan cho phép chọn từ các template"; "phần dashboard cho phép chọn phạm vi là nhóm dự án hay dự án".

## Hành vi
- **Tạo bảng:** nút "Tạo dashboard" mở **thư viện mẫu**. Mỗi mẫu có tên, mô tả một dòng và hình xem trước (sơ đồ khối widget). Chọn mẫu, rồi chọn **phạm vi dữ liệu**, rồi đặt tên (mặc định theo tên mẫu và tên phạm vi), rồi tạo. Bảng sinh ra đã có đủ widget và bố cục.
- **Phạm vi dữ liệu** (tách khỏi phạm vi chia sẻ PRIVATE/PROJECT/GLOBAL/TEAM đang có):
  - **Một dự án.**
  - **Một nhóm dự án.** Đây là nhóm CÁ NHÂN của người tạo, `Program` có `ownerId`. Số liệu gộp mọi dự án trong nhóm. Người xem chỉ thấy phần thuộc dự án họ xem được. Nếu người xem không phải chủ nhóm thì vẫn dùng danh sách dự án của nhóm đó, giao với quyền xem của họ.
  - **Cả tổ chức:** chỉ quản trị chung (`organization:admin`).
- Widget mặc định đọc phạm vi của bảng. Widget nào đã tự đặt dự án riêng thì giữ cách cũ. Đổi được phạm vi bảng sau khi tạo (trong hộp cài đặt bảng); các widget theo bảng tự cập nhật.
- **Mẫu (ruling):** định nghĩa trong code `packages/shared/src/dashboard-templates.ts`, chỉ dùng widget đang có.
  1. **Tổng quan dự án (PM):** tiến độ, việc quá hạn, burndown hoặc điểm theo tuần, việc theo trạng thái, việc theo người.
  2. **Kiểm thử (QA):** hàng chờ test lại, bug theo trạng thái, xu hướng bug 14 ngày, tỉ lệ mở lại, bug theo mức nghiêm trọng. Nếu thiếu widget nào thì thêm, ví dụ "tỉ lệ mở lại".
  3. **Lập trình viên:** việc của tôi, WIP, đến hạn 7 ngày, điểm đã xong của tôi.
  4. **Quản lý tổ chức:** theo dự án hoặc theo nhóm, quá hạn, điểm theo tuần theo dự án.
  5. **Trống.**
- Chưa cho người dùng lưu mẫu riêng ở đợt này.

## Ràng buộc
- DESIGN.md, UX_CONVENTIONS.md. Copy dùng "tổ chức". Không có chữ "workspace" (có guard test).
- Migration (thêm cột phạm vi dữ liệu) chạy được trên prod (PostgreSQL 16).
