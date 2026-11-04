# Tổng quan cá nhân & bộ lọc cá nhân xuyên workspace — thiết kế

Ngày: 2026-11-04 · Người dùng duyệt hướng đi ("không gộp", "giữ theo workspace + thêm loại cá nhân", "ngay, song song").

## Vì sao
Một người có thể làm cho nhiều nhóm, ví dụ tester ở cả TECA – KTA và TECA – Opendata. Hiện mọi màn hình chỉ thấy dữ liệu của workspace đang mở, nên người đó phải chuyển workspace liên tục và không có chỗ nào thấy toàn bộ việc của mình. Người dùng **không muốn gộp workspace**, mà muốn **phạm vi cá nhân xem xuyên các workspace** người đó là thành viên.

## Quyết định của người dùng
1. **Thêm trang "Tổng quan cá nhân".** Trang này gom việc của tôi từ mọi dự án tôi có quyền xem, ở mọi workspace tôi là thành viên.
2. **Bộ lọc có thêm loại "cá nhân".** Bộ lọc cá nhân thuộc về người dùng, không gắn workspace, và chạy trên mọi workspace của người đó. **Bộ lọc của workspace giữ nguyên** như hiện nay (gắn workspace, có chia sẻ).
3. **Làm ngay, song song** với đợt "quy trình theo loại việc".

## Hành vi

### Phạm vi dữ liệu
- "Workspace của tôi" là các workspace mà tôi có `WorkspaceMembership`, trừ workspace đã lưu trữ hoặc xoá. Trong mỗi workspace, chỉ những dự án tôi **được xem** theo đúng luật hiện tại: dự án riêng tư thì phải là thành viên, dự án đã xoá thì loại, dự án lưu trữ theo luật hiện có. Không có đường tắt bỏ qua RBAC.
- Mọi kết quả kèm `workspace { id, name }` và mã dự án.

### Trang Tổng quan cá nhân (`/me`, mục "Của tôi" trên thanh bên; không phụ thuộc workspace đang mở)
- Ô số: việc của tôi chưa xong · quá hạn · đến hạn trong 7 ngày · điểm đã xong trong tuần.
- **Việc của tôi:** danh sách gom từ mọi workspace, xếp theo hạn rồi ưu tiên.
  - Mỗi dòng có nhãn workspace/dự án, tên trạng thái thật, điểm và hạn.
  - Lọc nhanh theo workspace hoặc dự án.
- **Bug liên quan đến tôi:** bug tôi báo đang chờ test lại hoặc mở lại, và bug giao cho tôi.
  - Khi chưa có Bug Workflow thì dùng các trạng thái IN_PROGRESS có tên chứa "test".
  - Khi đợt quy trình xong thì dùng đúng `Ready for Retest` / `Reopened`.
- **Điểm đã xong theo tuần** (8 tuần gần nhất), cột chồng theo dự án. Chỉ tính việc lá, giống quy tắc điểm hiện có.
- **Bấm một việc ở workspace khác** thì hệ thống tự gọi đổi workspace rồi mở việc đó, không bắt người dùng chọn lại.

### Bộ lọc
- Trang Bộ lọc có hai nhóm bộ lọc đã lưu: **"Của workspace này"** (như cũ) và **"Cá nhân (mọi workspace)"**.
- Ô chạy JQL có công tắc phạm vi **"Workspace này / Mọi workspace của tôi"**. Chọn "Mọi workspace" là chạy xuyên workspace.
- Lưu bộ lọc thì chọn **Cá nhân** hoặc **Workspace**. Bộ lọc cá nhân không chia sẻ được ở đợt này.
- Kết quả xuyên workspace có thêm cột **Workspace** và **Dự án**.
- JQL có thêm trường `workspace` (theo tên, ví dụ `workspace = "TECA – Opendata"`). Trường này chỉ có ý nghĩa trong phạm vi cá nhân.
- **Giá trị không tồn tại ở một workspace** thì workspace đó cho 0 kết quả, không báo lỗi. Ví dụ trạng thái "Chờ test" có ở KTA nhưng không có ở workspace kia. Chỉ báo lỗi khi giá trị không tồn tại ở **mọi** workspace.
- **Sửa hàng loạt trên kết quả xuyên workspace:** chỉ bật khi tất cả việc được chọn cùng một workspace. Chọn lẫn nhiều workspace thì hiện ghi chú "Chọn việc cùng một workspace để sửa hàng loạt". Phần này sẽ mở rộng sau.

### Hiệu năng
- Truy vấn chạy tuần tự hoặc song song có giới hạn theo từng workspace, rồi gộp và sắp xếp. Phân trang dùng con trỏ ghép. Mỗi trang tối đa 200 việc.
- Số workspace của một người nhỏ (dưới 10), nên chấp nhận được.

## Không làm (đợt này)
- Chia sẻ bộ lọc cá nhân.
- Sửa hàng loạt lẫn nhiều workspace.
- Bảng tổng quan tuỳ biến cá nhân xuyên workspace.
- Chatbot xuyên workspace.

## Ràng buộc
- Tuân `CLAUDE.md` (Prisma migration, zod trong `packages/shared`, lỗi `SCREAMING_SNAKE`, list trả envelope).
- Không phá cô lập dữ liệu theo workspace của các API hiện có: endpoint mới nằm dưới `/me/*`, tự lặp qua membership và gọi lại service theo từng `workspaceId`.
- Đợt này chạy song song với `feat/workflow-per-type`. Nhánh nào merge sau thì rebase. Phần dễ đụng nhau: `saved-filters` (web), danh sách gợi ý trạng thái trong JQL.
