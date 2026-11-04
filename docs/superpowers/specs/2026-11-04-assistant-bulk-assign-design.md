# Chatbot: giao việc hàng loạt — thiết kế (nháp)

Ngày: 2026-11-04 · Làm **sau** đợt "quy trình theo loại việc" (người dùng chọn).

## Mục tiêu
Trong Trợ lý Tirapro (chatbot theo luật, `apps/web/src/features/assistant/`), người dùng gõ lệnh giao **nhiều việc** cho **một hoặc nhiều người**. Chatbot không gán ngay mà hiện **thẻ xem trước** để người dùng kiểm, sửa, rồi bấm **Xác nhận**. Sau khi gán có **Hoàn tác**.

## Mẫu câu (intent mới `bulk-assign`)
- Danh sách mã: `giao KYHOP-SUB-11, 12, 15 cho Thuỷ`. Số trần được hiểu là cùng tiền tố với mã đứng trước.
- Dải mã: `giao KYHOP-SUB-11..20 cho Linh`, hoặc `11-20`.
- Việc con của một việc: `giao việc con của KYHOP-TASK-12 cho …`.
- Bộ lọc nhẹ: `giao các việc [Test] chưa giao của KYHOP cho …`.
  - Điều kiện hiểu được: tiền tố tiêu đề trong `[...]`, "chưa giao", dự án, loại (bug/task/sub-task), Epic theo mã.
  - Bộ lọc được dịch sang JQL và hiển thị trên thẻ để người dùng thấy chatbot đã hiểu gì.
- Theo cặp: `giao KYHOP-SUB-11 cho Thuỷ, KYHOP-SUB-12 cho Linh`.
- Người nhận: khớp tên hiển thị hoặc email, không phân biệt dấu. Tên trùng nhiều người thì thẻ yêu cầu chọn.

## Cách chia (người dùng: "làm thành các option, có thể gán hết cho 1 người chỉ định")
Trên thẻ xem trước có ô chọn **Cách chia**:
1. **Tất cả cho một người**: chọn một người từ danh sách. Mặc định khi lệnh chỉ nêu một người.
2. **Chia đều lần lượt** theo thứ tự mã. Mặc định khi lệnh nêu nhiều người.
3. **Chia đều theo điểm**: cân tổng điểm mỗi người, có tính cả việc chưa xong họ đang giữ.
4. **Theo cặp**: dùng khi câu lệnh ghi cặp việc–người.

Đổi cách chia thì bảng xem trước cập nhật ngay. Mỗi dòng sửa được người nhận hoặc bỏ dòng.

## Quyền và an toàn
- Ai **có quyền giao việc** (`issue:assign`) ở dự án đó thì dùng được, giống sửa hàng loạt trên giao diện.
- Dòng không đủ quyền, hoặc người nhận không thuộc dự án, bị đánh dấu và bỏ qua, có ghi lý do.
- Gán qua API sửa hàng loạt hiện có (`PATCH /issues/bulk`, mỗi dự án tối đa 100 việc mỗi lần, có OCC). Việc bị xung đột phiên bản thì báo lại.
- Kết quả: "Đã giao N việc", kèm nút **Hoàn tác** khôi phục người phụ trách cũ.

## Không làm
- Hiểu ngôn ngữ tự do bằng AI. Đây vẫn là trợ lý theo luật; câu không khớp mẫu sẽ được gợi ý mẫu đúng.

## Bổ sung 2026-11-05 (người dùng): mọi thao tác hàng loạt làm qua trợ lý AI
Người dùng nói: các thao tác hàng loạt, như thêm người vào hàng loạt dự án hay gán hàng loạt việc cho người nào đó, đều làm ở AI agent. Đợt này gồm 3 intent, cùng một khuôn: thẻ xem trước, sửa hoặc bỏ từng dòng, Xác nhận, rồi Hoàn tác.
1. **`bulk-assign`:** như phần trên.
2. **`bulk-add-member`:** ví dụ `thêm Linh, Thuỷ vào KYHOP, LLTT với vai trò Tester`, `thêm Nhóm QA vào GSDA vai trò Tester`, `thêm Hương vào mọi dự án nhóm Thanh Hóa của tôi`. Nhóm ở đây là nhóm dự án cá nhân của người gõ.
   - Thẻ hiện bảng người × dự án × vai trò. Vai trò chọn được và mặc định lấy từ câu lệnh.
   - Dòng nào người gõ không có quyền `project:admin` ở dự án đó, hoặc người được thêm đã là thành viên với vai trò đó, thì đánh dấu và bỏ qua.
   - Khi chạy dùng đúng API thành viên dự án hiện có. Nếu là team của tổ chức thì dùng liên kết team, sau khi đợt team theo dự án đã deploy.
   - Hoàn tác gỡ đúng phần vừa thêm.
3. **`bulk-remove-member`:** ví dụ `gỡ Linh khỏi KYHOP, LLTT`. Thẻ cảnh báo nếu người đó vẫn còn trong dự án nhờ một team. Hoàn tác thêm lại đúng vai trò cũ.

Người và dự án khớp theo tên, email hoặc mã, không phân biệt dấu. Tên trùng nhiều người thì thẻ bắt chọn. Đây vẫn là trợ lý theo luật, không dùng AI hiểu ngôn ngữ tự do. Có ANTHROPIC_API_KEY thì có thể dùng AI để tách câu, nhưng thẻ xem trước vẫn bắt buộc.
