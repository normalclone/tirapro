# Một vai trò "Quản trị" (gộp Quản trị tổ chức + Quản trị hệ thống) — thiết kế

Ngày 2026-11-06. Người dùng: "gom vai trò quản trị tổ chức và quản trị hệ thống lại", chọn phương án **một vai trò "Quản trị"**:
ai là Quản trị tổ chức thì cũng là Quản trị hệ thống và ngược lại; gán/bỏ ở một chỗ. Prod hiện có 1 tổ chức (TECA); chỉ
`superadmin` có cả `User.isSystemAdmin = true` và vai trò tổ chức `Organization Admin` (dữ liệu đang khớp).

## Quyết định
1. **Giữ nguyên cơ chế kiểm quyền máy chủ** (`isSystemAdmin` cho route /admin, `organization:admin` cho route tổ chức). Không nới
   guard. Thay vào đó **đồng bộ hai cờ** ở một service duy nhất (vd `AdminSyncService` trong module members/admin):
   - Vai trò tổ chức của một người chuyển THÀNH `Organization Admin` (thêm thành viên với vai trò đó, đổi vai trò, tạo tài khoản kèm
     vai trò) → đặt `isSystemAdmin = true`.
   - Vai trò tổ chức chuyển KHỎI `Organization Admin` (đổi vai trò, gỡ khỏi tổ chức) → `isSystemAdmin = false` nếu người đó không còn
     là `Organization Admin` ở tổ chức nào.
   - Bật "Quản trị" cho một tài khoản ở Quản trị hệ thống › Tài khoản (chỗ đang bật `isSystemAdmin`) → `isSystemAdmin = true` VÀ
     đặt vai trò tổ chức `Organization Admin` ở mọi tổ chức người đó thuộc (nếu chưa thuộc tổ chức nào: thêm vào tổ chức duy nhất
     đang hoạt động khi chỉ có đúng 1; nhiều tổ chức thì chỉ đặt cờ). Tắt → `isSystemAdmin = false` và vai trò tổ chức về
     `Organization Member`.
   - Ghi cả hai thay đổi trong cùng transaction; xoá cache quyền (`rbac:*` của người đó) như các chỗ đổi vai trò hiện có.
   - Chặn: không được bỏ Quản trị của **người Quản trị cuối cùng** (422 với thông báo tiếng Việt rõ); không tự bỏ quyền của chính
     mình nếu đó là người cuối.
   - Dự án: vai trò dự án mặc định của Organization Admin (Project Admin) giữ như cũ.
2. **Giao diện — một chữ "Quản trị"**:
   - Thanh trái: "Quản trị hệ thống" → **"Quản trị"** (nhãn ở `navLabels`, sheet "Tôi", tour, tài liệu, trợ lý). Khu /admin giữ đường dẫn.
   - Tên vai trò tổ chức `Organization Admin` hiển thị là **"Quản trị"** ở mọi chỗ người dùng thấy (bộ chọn vai trò ở Thành viên,
     danh sách vai trò, huy hiệu) — tên trong DB/hằng số giữ nguyên (code đang tra theo tên).
   - Quản trị › Tài khoản: công tắc "Admin HT" → **"Quản trị"**, tooltip nói rõ bật = có toàn quyền tổ chức và khu Quản trị.
   - Bỏ/ẩn mọi chữ phân biệt "quản trị tổ chức" vs "quản trị hệ thống" trên giao diện (vd NoAccess `who="quản trị hệ thống"`,
     mô tả trang). Dùng "Quản trị".
3. **Dữ liệu**: không cần backfill (đang khớp). Thêm một script kiểm tra `pnpm --filter @tirapro/api run admins:check` (chỉ đọc) liệt
   kê người lệch hai cờ — để chạy sau deploy.

## Ràng buộc
- Tiếng Việt, "tổ chức", không "workspace". Có test cho mọi nhánh đồng bộ + chặn người cuối + 2 chiều.
- Gate: build types+shared, `pnpm -r typecheck`, `pnpm lint` (0 lỗi, ≤88 cảnh báo), `pnpm test`, `pnpm format:check`, `pnpm knip`,
  impeccable detect không thêm finding. Có test cấm chữ "workspace".
