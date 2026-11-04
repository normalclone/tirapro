# Quy trình theo loại việc, cấu hình ở cấp workspace — thiết kế

Ngày: 2026-11-04 · Trạng thái: **nháp chờ người dùng duyệt** (làm sau khi đợt `feat/points-due-status` đã deploy)

## Vì sao
Hiện mỗi dự án có đúng một quy trình (`Project.defaultWorkflowId`), dùng chung cho mọi loại việc. Bug cần vòng đời riêng (test lại, mở lại), Epic cần vòng đời nghiệm thu, còn Task của BA/Dev/Tester cần bước review và sửa lại. Người dùng muốn **cấu hình một lần ở workspace và áp cho toàn bộ dự án trong workspace**, để mọi dự án cùng chung cách làm và thống kê so sánh được.

## Quyết định của người dùng
- **Cấu hình theo loại việc ở cấp workspace** (giống "workflow scheme" của Jira, gắn với workspace).
- **Dùng chung, có ngoại lệ.** Mọi dự án theo cấu hình của workspace; sửa ở workspace là áp ngay cho tất cả. Workspace Admin có thể cho **một dự án dùng quy trình riêng** cho một hoặc nhiều loại việc.
- **Bộ mặc định** là bản nháp ba quy trình, **tên tiếng Anh**, có Pending và Cancelled. Story và Sub-task dùng Standard.
- **Áp cho tất cả workspace** ngay lần đầu (TECA – KTA, TECA – Opendata và các workspace khác). Dữ liệu cũ được chuyển trạng thái theo bảng ánh xạ.
- **Workspace Admin** (và SA) được sửa cấu hình quy trình của workspace.
- **Cấp dự án** (người dùng bổ sung 2026-11-04): ở trang cấu hình dự án `/p/<KEY>/config/workflow` có bảng "Loại việc → Quy trình". Mỗi loại chọn được "Theo workspace" hoặc một quy trình riêng. **Project Admin** của dự án, Workspace Admin và SA được sửa.

## Ba quy trình mặc định

| Quy trình | Áp cho loại | Trạng thái (nhóm) | Bước chuyển chính |
|---|---|---|---|
| **Standard Workflow** | Task, Story, Sub-task, loại tuỳ chỉnh | To Do (TODO), Ready (TODO), In Progress (IN_PROGRESS), In Review (IN_PROGRESS), Rework (IN_PROGRESS), Pending (IN_PROGRESS), Done (DONE), Cancelled (DONE) | To Do→Ready→In Progress→In Review→Done; In Review→Rework→In Progress; mọi trạng thái mở→Pending; Pending→trạng thái mở trước đó; mọi trạng thái mở→Cancelled |
| **Bug Workflow** | Bug | New (TODO), To Do (TODO), In Progress (IN_PROGRESS), Ready for Retest (IN_PROGRESS), Reopened (IN_PROGRESS), Pending (IN_PROGRESS), Done (DONE), Closed (DONE), Cancelled (DONE) | New→To Do→In Progress→Ready for Retest→Done→Closed; Ready for Retest→Reopened→In Progress; Pending/Cancelled như trên |
| **Epic Workflow** | Epic | Not Started (TODO), In Progress (IN_PROGRESS), Awaiting Acceptance (IN_PROGRESS), Pending (IN_PROGRESS), Done (DONE), Cancelled (DONE) | Not Started→In Progress→Awaiting Acceptance→Done; Pending/Cancelled như trên |

Trạng thái khởi tạo: To Do / New / Not Started.

"Pending → trạng thái mở trước đó": khi rời Pending, giao diện gợi ý quay về đúng trạng thái trước khi tạm dừng (lấy từ lịch sử). Vẫn cho chọn trạng thái mở khác.

## Hành vi
1. **Cấu hình workspace** (*Cài đặt → Quy trình*):
   - Có bảng "Loại việc → Quy trình" và danh sách quy trình của workspace.
   - Sửa trạng thái hoặc bước chuyển của một quy trình là áp cho mọi dự án đang dùng nó.
   - Không xoá được trạng thái đang có việc. Muốn xoá phải chọn trạng thái thay thế, rồi hệ thống chuyển các việc đó sang.
2. **Ngoại lệ theo dự án:** Project Admin (hoặc Workspace Admin) chọn "dùng quy trình riêng cho loại X". Hệ thống chép quy trình của workspace thành bản riêng của dự án để sửa. Có nút "quay về dùng chung", kèm ánh xạ trạng thái.
3. **Tạo việc:** trạng thái khởi tạo lấy theo quy trình của loại việc.
4. **Đổi loại việc** (ví dụ Task thành Bug): nếu quy trình đích khác, hệ thống hỏi trạng thái đích. Mặc định chọn trạng thái cùng tên, nếu không có thì trạng thái đầu tiên cùng nhóm.
5. **Bảng việc:**
   - Mỗi cột gom được trạng thái của nhiều quy trình (cột đã nhận nhiều trạng thái).
   - Cột mặc định đi theo nhóm: To Do, In Progress, Done. Dự án tự chia cột chi tiết hơn được.
   - Kéo thẻ vào cột chỉ được khi quy trình của loại việc đó có bước chuyển hợp lệ.
6. **Chuyển trạng thái, quy tắc chặn, WIP, SLA, tự động hoá:** đều đọc quy trình theo loại việc của từng issue. Quy tắc tự động hoá trỏ tới trạng thái cũ được ánh xạ sang trạng thái mới khi migrate; quy tắc nào không ánh xạ được thì tắt và báo cho người tạo.
7. **JQL và bộ lọc:**
   - `status = "In Progress"` khớp theo tên trên mọi quy trình.
   - `statusCategory` vẫn dùng như cũ.
   - Danh sách trạng thái trong bộ lọc gộp theo tên.

## Ánh xạ dữ liệu cũ (đề xuất — người dùng duyệt)

Quy trình hiện có "Phát triển phần mềm" (9 trạng thái), dùng ở ATP, TIRA, KYHOP, LLTT, GSDA:

| Trạng thái cũ | → Standard | → Bug | → Epic |
|---|---|---|---|
| Cần làm | To Do | New | Not Started |
| Đang phân tích | To Do | To Do | Not Started |
| Sẵn sàng phát triển | Ready | To Do | Not Started |
| Đang làm | In Progress | In Progress | In Progress |
| Review code | In Review | In Progress | In Progress |
| Chờ test | In Review | Ready for Retest | In Progress |
| Đang test | In Review | Ready for Retest | In Progress |
| Hoàn thành | Done | Done | Done |
| Không xử lý | Cancelled | Cancelled | Cancelled |

Các quy trình khác ("Việc chung", Kanban, Scrum, "Quản lý yêu cầu"): trạng thái cùng tên thì giữ, còn lại ánh xạ theo nhóm (TODO→trạng thái khởi tạo; IN_PROGRESS→In Progress; DONE→Done). Bảng ánh xạ đầy đủ được in ra để duyệt trước khi chạy trên production.

## Không làm (đợt này)
- **Epic tự chuyển trạng thái theo việc con.** Đây là đề xuất riêng, chưa chốt.
- Màn hình (screen) và trường bắt buộc khác nhau theo quy trình.
- Quy trình theo loại việc riêng cho từng *board*.

## Ràng buộc
- Đi theo `CLAUDE.md`: Prisma migration, `gen:enums`, mã lỗi `SCREAMING_SNAKE`, OCC.
- Migrate chạy được nhiều lần mà không sinh khác biệt.
- Deploy sao lưu DB trước, và in bảng ánh xạ cùng số việc bị chuyển trước khi đổi dữ liệu.
- Mặc định bộ mới cho workspace mới; template "Scrum/Kanban/Quản lý yêu cầu" vẫn dùng được làm quy trình ngoại lệ.
