# Team theo dự án — thiết kế

Ngày: 2026-11-05. Người dùng chốt: các team được thêm theo dự án. Có cả hai loại team:
- Team của tổ chức, thêm vào dự án kèm vai trò.
- Team riêng trong dự án, dùng để lọc và nhóm trên bảng việc và trong báo cáo.

## 1. Team tổ chức gắn vào dự án (có đồng bộ)
- **Liên kết:** `ProjectTeamLink(projectId, teamId, roleIds[])`.
  - Gắn team thì mọi thành viên team thành thành viên dự án với các vai trò đó.
  - Thêm người vào team thì người đó tự vào mọi dự án team đang gắn.
  - Bớt người khỏi team, hoặc gỡ team khỏi dự án, thì chỉ gỡ phần vai trò người đó có **nhờ team**. Vai trò gán trực tiếp được giữ.
  - Xoá team thì coi như gỡ team khỏi mọi dự án.
- **Ruling về cách lưu:** ghi nguồn cho từng vai trò dự án, `ProjectMembershipRole.source = DIRECT | TEAM` cùng `teamId?`. Một người có cùng vai trò từ hai nguồn thì giữ cả hai dòng nguồn. Người đó chỉ mất vai trò khi không còn nguồn nào. Khi tư cách thành viên dự án không còn vai trò nào thì xoá luôn tư cách đó.
  - Vai trò chính `ProjectMembership.roleId` hiện có là một trường cũ. Người implement phải giữ nó nhất quán (ví dụ lấy vai trò đầu tiên còn lại) và ghi rõ đã làm thế nào.
- **Quyền:** gắn hoặc gỡ team cần `project:admin` của dự án đó (hoặc `organization:admin`). Sửa thành viên team cần quyền quản lý team như hiện tại.
- **Quyền hiệu lực không bao giờ giảm vì gắn team (dự án công khai):** thành viên chỉ do team gắn vào (có vai trò nhưng không vai trò nào gán trực tiếp) vẫn được cộng vai trò mặc định suy từ vai trò tổ chức (`RbacService.compute`). Ghi đè tường minh (có vai trò gán trực tiếp) và dự án riêng tư giữ nghĩa "thay thế" / "chỉ các dòng thành viên". Danh sách thành viên dự án công khai hiện luôn cả vai trò mặc định đó.
- **Chống leo thang:** vai trò mang `organization:admin` chỉ quản trị tổ chức mới thêm/gỡ qua gắn/gỡ team. Vì sửa thành viên team (hay xoá team) thực chất cấp/gỡ quyền cho cả team, nếu team đang gắn vai trò loại đó thì sửa thành viên / xoá team cũng cần `organization:admin` (`team:manage` một mình không đủ). Team không gắn vai trò quản trị nào giữ quyền như cũ.
- **Giao diện:** Cấu hình dự án → Thành viên thêm tab "Team" để gắn team, chọn vai trò, xem số người và gỡ. Danh sách thành viên dự án hiện nguồn của từng người ("qua Team QA"). Cảnh báo khi gỡ một người mà họ vẫn còn trong dự án nhờ team khác.
- Dữ liệu cũ: nút "Thêm cả nhóm vào dự án" trước đây chỉ chép thành viên một lần. Các tư cách thành viên đó giữ nguyên, nguồn là DIRECT.

## 2. Team riêng trong dự án (không cấp quyền)
- **Bảng:** `ProjectSubTeam(projectId, name, color)` và `ProjectSubTeamMember(subTeamId, userId)`. Người trong team phải là thành viên dự án.
- **Ruling:** một người được ở nhiều team trong cùng dự án.
- **Quản lý:** ở Cấu hình dự án → Thành viên, tab "Team trong dự án". Cần `project:admin`.
- **Lọc:**
  - Bảng việc có bộ lọc nhanh "Team" (lọc việc có người phụ trách thuộc team) và "Nhóm theo team" (swimlane).
  - Báo cáo dự án có số việc và điểm theo team, có lọc theo team.
  - JQL có trường `team` theo tên team trong dự án, ví dụ `team = "QA"`, nghĩa là assignee thuộc team đó.

## Ràng buộc
- Chạy được trên prod PostgreSQL 16. Copy dùng "tổ chức". Có guard test cấm chữ "workspace".
- Thao tác hàng loạt (thêm nhiều người vào nhiều dự án) KHÔNG làm ở đây. Việc đó làm qua trợ lý AI ở đợt sau.
