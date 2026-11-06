# Vai trò theo dự án, dự án công khai chỉ xem, dự án mới riêng tư — thiết kế

Ngày 2026-11-06. Làm SAU `2026-11-06-single-admin-design.md`, cùng nhánh `feat/single-admin` (worktree /Users/inrnee/tirapro-wt/admin).
Bối cảnh: người dùng xác nhận "vai trò/quyền giờ là theo dự án", "thành viên cũng theo dự án". Báo cáo rà soát:
/Users/inrnee/tirapro-data/vm128/Ra-soat-vai-tro-thanh-vien-theo-du-an.xlsx (đọc bằng openpyxl).

## A. Vai trò riêng của dự án (người dùng: "PM tự custom Vai trò & quyền riêng, Quản trị được sử dụng ở dưới dạng template;
PM muốn dùng thì phải tạo nhóm quyền và dùng template đó hoặc tự nhập")
- **Mẫu vai trò** = các vai trò cấp DỰ ÁN dùng chung (`Role.scope = PROJECT`, `projectId = null`: hệ thống + tuỳ chỉnh của tổ chức).
  Chỉ **Quản trị** tạo/sửa/xoá mẫu (trang Quản trị › Vai trò & quyền). Siết API tạo/sửa/xoá vai trò dùng chung về
  `organization:admin` (hiện đang `member:manage`) cho khớp giao diện.
- **Vai trò của dự án** = vai trò mới có `projectId` (thêm cột nullable `Role.projectId` + FK + index; migration không khoá bảng lớn).
  Người có `project:admin` của dự án đó (PM/Project Admin) tạo/sửa/xoá ở **Dự án › Thêm › Cấu hình › Vai trò** (mục mới):
  - "Tạo từ mẫu": chọn một mẫu → sao chép tên + quyền (đổi tên được), sau đó sửa quyền tự do.
  - "Tự chọn quyền": đặt tên + tick quyền (chỉ các quyền cấp dự án trong catalog; không cho cấp quyền tổ chức).
  - Không cho vai trò dự án vượt quyền người tạo? → Quyết định: Project Admin được cấp bất kỳ quyền cấp dự án nào (họ đã có
    `project:admin`), trừ không tạo vai trò chứa `project:admin` nếu chính họ không phải Quản trị? Không cần: giữ đơn giản, cho phép.
  - Xoá vai trò đang được gán → 422 kèm số người đang dùng.
  - Tên vai trò duy nhất trong dự án.
- **Gán vai trò trong dự án** (Cấu hình › Thành viên, hộp thêm người, chọn vai trò): danh sách chọn = **vai trò của dự án đó**;
  nếu dự án chưa có vai trò nào, hiện gợi ý "Tạo vai trò từ mẫu" (nút dẫn sang mục Vai trò). Các gán hiện có bằng vai trò hệ thống
  (Project Admin, Developer, Tester, Reporter…) **giữ nguyên, vẫn hiệu lực**, hiển thị bình thường; khi đổi vai trò cho một người
  thì chọn từ vai trò của dự án. Quản trị vẫn chọn được cả mẫu (để không kẹt).
  - Ngoại lệ an toàn: luôn được gán "Project Admin" mẫu cho người tạo dự án (tự động như hiện nay).
- RBAC: `getEffectivePermissions` tính được vai trò có `projectId` (chỉ có hiệu lực ở đúng dự án đó; vai trò dự án A gán ở dự án B
  → API từ chối). Xoá cache `rbac:*` liên quan khi sửa quyền vai trò.
- Trang Quản trị › Vai trò & quyền: ghi rõ đây là **Mẫu vai trò** dùng chung; vai trò riêng của từng dự án không hiện ở đây.

## B. Dự án công khai = chỉ xem
- Người không phải thành viên dự án công khai: chỉ xem (project:view + report:view), không tạo/sửa/chuyển trạng thái/bình luận.
  Đổi `DEFAULT_PROJECT_ROLE_BY_WS_ROLE[Organization Member]` từ Developer → null (quyền xem đến từ vai trò tổ chức) — kiểm lại mọi
  nơi dùng map này (bao gồm danh sách thành viên dự án công khai: chỉ liệt kê thành viên thật, không còn 21 người "mặc định").
- **Chuyển dữ liệu trước** (để không ai mất quyền): script một lần `pnpm --filter @tirapro/api run public-members:materialize
  [-- --dry-run]` — với mỗi dự án công khai còn sống, mỗi Organization Member chưa có ProjectMembership mà có hoạt động trong dự án
  (là người tạo/phụ trách/được giao/bình luận/log giờ trên việc của dự án) → tạo ProjectMembership vai trò Developer. In danh sách,
  `--dry-run` không ghi. (TIRA dự kiến 9 người — báo cáo rà soát.) Ghi cách chạy vào docs/DEPLOY.md.
- Ghi chữ giao diện: dự án công khai = "Mọi người trong tổ chức xem được; muốn làm việc cần được thêm vào dự án."

## C. Dự án mới mặc định riêng tư + thêm người ngay khi tạo
- Hộp tạo dự án: mặc định "Riêng tư" (vẫn đổi được); thêm ô chọn người tham gia (nhiều người, từ thành viên tổ chức) + vai trò ban đầu
  (mặc định: chưa có vai trò dự án → dùng mẫu "Developer"; cho chọn mẫu khác). Người tạo tự là Project Admin như hiện nay.
- API tạo dự án nhận `members?: { userId, roleId }[]` (zod), tạo trong cùng transaction.

## D. Sửa nhỏ theo rà soát
- Trang Thành viên (người thường): bỏ câu "Ai có tên ở đây đều tham gia mọi dự án" ở trang đầy đủ; với dự án mình là Project Admin,
  mỗi khối dự án có nút "Quản lý" dẫn tới Dự án › Cấu hình › Thành viên.
- `GET /members` (danh bạ tổ chức, có email): người không có `member:manage` chỉ nhận người cùng dự án mình tham gia (khớp giao diện).

## Ràng buộc & gate
Như spec single-admin. Mọi thay đổi quyền có test API (tạo vai trò dự án, gán chéo dự án bị từ chối, người không phải project admin
bị 403, công khai chỉ xem, script materialize dry-run). Không chạy gì trên prod.
