# Bỏ khái niệm workspace trong code — đổi thành Organization (tổ chức) — thiết kế

Ngày: 2026-11-05. Người dùng chốt hướng này ("bỏ luôn khái niệm workspace", rồi chọn "Đổi tên toàn bộ thành Company"). Sau đó người dùng sửa tên: dùng "tổ chức", tức **Organization** trong code.

## Bối cảnh
- Prod đã gộp xong thành MỘT tổ chức "TECA" (2026-11-04).
- Giao diện đã đổi hết chữ sang "tổ chức", đã bỏ bộ chọn, đã bỏ nút "Tạo tổ chức". Việc này đã deploy.
- Trong code, khái niệm workspace vẫn còn ở khoảng 513 file, khoảng 3.600 lần dùng `workspaceId` và 40 model.

## Mục tiêu
Trong code, cơ sở dữ liệu, API, token, realtime, quyền, cache, tài liệu và CLAUDE.md không còn từ "workspace" theo nghĩa tenant. Mọi chỗ đều là **Organization / organizationId / tổ chức**. Hành vi không đổi.

## Phạm vi đổi tên
- **Prisma:**
  - `model Workspace` thành `Organization`; `WorkspaceMembership` thành `OrganizationMembership`; `WorkspaceMembershipRole` thành `OrganizationMembershipRole`; `WorkspaceWorkflowScheme` thành `OrganizationWorkflowScheme`.
  - Mọi cột `workspaceId` thành `organizationId`.
  - Enum hoặc giá trị nào mang chữ WORKSPACE thì đổi sang ORGANIZATION. Ví dụ: `Role.scope WORKSPACE` thành `ORGANIZATION`, phạm vi dashboard, phạm vi wiki.
  - Migration chỉ dùng `ALTER TABLE … RENAME`, `RENAME COLUMN`, `ALTER TYPE … RENAME VALUE`, đổi tên index và constraint. **Không chép dữ liệu.** Phải chạy nhanh và an toàn trong một transaction.
  - Chỉ mục toàn văn và pgvector của `db:raw` (`apps/api/prisma/sql/01_pgvector_fts.sql`) cũng đổi tên cột theo.
- **Quyền:**
  - `workspace:admin` thành `organization:admin`; `workspace:view` thành `organization:view`.
  - Tên vai trò hệ thống `Workspace Admin/Member/Viewer` thành `Organization Admin/Member/Viewer`. Nhãn hiển thị tiếng Việt giữ nguyên ("Quản trị chung", "Thành viên", "Người xem").
  - Migration đổi khoá quyền trong DB. Seed-system-roles phải upsert theo tên mới và không tạo vai trò trùng. Cần một bước đổi tên vai trò cũ trước khi seed.
  - Cache RBAC trong Redis: đổi tiền tố khoá nếu khoá có chứa chữ workspace. Sau khi deploy thì xoá `rbac:*`.
- **API:**
  - `/workspaces` thành `/organizations`; `/auth/workspaces` thành `/auth/organizations`; `/auth/switch-workspace` thành `/auth/switch-organization`.
  - Admin: `/admin/workspaces` thành `/admin/organizations`.
  - Decorator `@WorkspaceId()` thành `@OrganizationId()`. Đổi tên các module, service, file `workspace*`.
  - Mã lỗi chứa WORKSPACE đổi sang ORGANIZATION. Tên sự kiện domain và WS `workspace.*` / `workspace:*` cũng đổi.
- **Token và phiên:** claim JWT `workspaceId` thành `organizationId`. API **chấp nhận cả claim cũ** trong thời gian access token còn sống (đọc `organizationId ?? workspaceId`) để không bắt ai đăng nhập lại. Refresh xong thì phát claim mới.
- **Realtime:** room `ws:{id}` thành `org:{id}`. Phía web cùng bản deploy nên không cần giữ tương thích.
- **Packages:** `@tirapro/types` và `@tirapro/shared` gồm DTO, zod, sự kiện, danh mục quyền. Chạy `pnpm gen:enums`.
- **Web:** store `workspaceId` thành `organizationId`; `features/workspace` thành `features/organization`; query key, route `/admin/workspaces` thành `/admin/organizations` (giữ redirect từ đường dẫn cũ). Đổi tên test theo.
- **Script và vận hành:** script trong `apps/api/scripts/*` và `docs/*`; `CLAUDE.md` (mục "Quy ước chốt": Tenant = `Organization`, REST `/organizations`, claim `organizationId`, room `org:{id}`); `docs/MASTER_PLAN.md`, `DEPLOY.md`, `ARCHITECTURE_SCALE.md`.
- **Ngoại lệ được giữ:** tên migration cũ trong `prisma/migrations/*` (lịch sử, không sửa) và chú thích lịch sử trong release notes cũ.

## Không làm
- Không đổi hành vi, không đổi UI. Chữ hiển thị đã là "tổ chức".
- Không bỏ hẳn lớp tenant (người dùng đã chọn giữ một cấp tổ chức).

## Kiểm chứng
- **Cổng chất lượng đầy đủ:** typecheck, lint (≤ trần), test, `format:check`, knip.
- **Grep chặn tái phạm:** thêm test quét `apps/*/src` và `packages/*/src` để không còn `workspace` (không phân biệt hoa thường), trừ danh sách ngoại lệ có lý do.
- **Trên bản sao prod:** chạy `prisma migrate deploy`, rồi seed-roles, rồi API khởi động được. Đăng nhập bằng token cũ vẫn chạy; đăng nhập mới nhận claim mới. Không có vai trò trùng. Số dòng mọi bảng không đổi.
- **Deploy:** sao lưu, rồi chạy migrate, rồi xoá `rbac:*` trong Redis, rồi kiểm tra bằng ảnh chụp.
