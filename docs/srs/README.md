# SRS — Tirapro

Bộ tài liệu đặc tả yêu cầu phần mềm (SRS) của Tirapro (Jira clone + AI, realtime, analytics), viết bằng tiếng Việt theo khung SRS-PortalLite: mỗi tài liệu chức năng gồm **thực thể dữ liệu → API request/response (validation, thông báo lỗi) → luồng nghiệp vụ & quy tắc → giao diện → phân quyền → tiêu chí chấp nhận**.

- **Phiên bản bộ tài liệu:** 0.1
- **Ngày cập nhật:** 2026-10-29
- **Nguyên tắc:** nội dung đối chiếu trực tiếp với mã nguồn; thông báo lỗi trích nguyên văn từ code. Khi code đổi, đổi tài liệu cùng commit.

## Mục lục

| Tài liệu | Nội dung | Phiên bản | Ngày | Trạng thái |
|---|---|---|---|---|
| [00-tong-quan.md](00-tong-quan.md) | Giới thiệu, phạm vi, thuật ngữ, bối cảnh kỹ thuật, nhóm chức năng, actor, ràng buộc chung | 0.1 | 2026-10-29 | Bản nháp |
| [10-import-hang-loat.md](10-import-hang-loat.md) | Nhập công việc hàng loạt: biểu mẫu Excel (chính), CSV, JSON, lịch sử nhập (Jira: chỉ tóm lược) | 0.1 | 2026-10-29 | Đã đối chiếu code |
| [11-tro-ly-chatbot.md](11-tro-ly-chatbot.md) | Trợ lý Tirapro (ô chat nổi, chế độ cơ bản không AI ngoài): ý định, kho hướng dẫn, tra việc, tạo việc nháp → xác nhận | 0.1 | 2026-10-29 | Đã đối chiếu code |

Đánh số: `00` tổng quan; `10`, `20`, … là các nhóm chức năng (chừa chỗ chèn thêm tài liệu). Các nhóm chức năng chưa có file được liệt kê ở [00-tong-quan.md §4](00-tong-quan.md#4-nhóm-chức-năng) với ghi chú "chưa đặc tả chi tiết".

## Quy ước

- **Trạng thái mục:** `Bản nháp` (viết nhưng chưa đối chiếu hết code) · `Đã đối chiếu code` (đã so từng thông báo/giới hạn với mã nguồn tại ngày ghi) · `Chưa đặc tả chi tiết` (mới có tên nhóm).
- **Phiên bản:** `MAJOR.MINOR` — MAJOR tăng khi đổi hành vi/hợp đồng API; MINOR khi bổ sung/chỉnh câu chữ. Ghi ngày `yyyy-mm-dd`.
- **Trường/field** viết đúng tên trong mã nguồn (Prisma/DTO/zod) để đối chiếu với đội phát triển.
- **⚠️ Ghi chú/rủi ro:** điểm không nhất quán hoặc giới hạn đã biết, cần đội xác nhận "cần sửa" hay "chấp nhận".
- **Tiêu chí chấp nhận** viết dạng Given / When / Then, đánh mã `AC-<mục>-<số>`.
- Ngày lịch hiển thị `dd/mm/yyyy` (theo `docs/UX_CONVENTIONS.md`); thông báo lỗi cho người dùng bằng tiếng Việt, nói rõ cần làm gì tiếp.
