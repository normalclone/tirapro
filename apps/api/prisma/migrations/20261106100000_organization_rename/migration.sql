-- Đổi tên khái niệm Workspace -> Organization (tổ chức). CHỈ đổi tên (bảng, cột, kiểu enum, giá trị enum, ràng buộc, chỉ mục) và khoá
-- quyền / tên vai trò hệ thống / nhãn nhật ký; không sao chép dữ liệu. Chạy trong một transaction (Prisma bọc sẵn) — số dòng mọi bảng không đổi.
--
-- Cột, ràng buộc và chỉ mục được đổi bằng vòng lặp theo danh mục hệ thống (không liệt kê cứng) nên bao gồm cả mọi đối tượng sinh ra bởi các
-- migration trước (vd `personal_groups`: unique (workspaceId, ownerId, name)) và chạy được trên cả PostgreSQL 16 (prod) lẫn 18: chỉ đụng ràng buộc
-- khoá chính / khoá ngoại / duy nhất / kiểm tra (`contype` p, f, u, c) — ràng buộc NOT NULL có tên chỉ tồn tại từ PG 18, không đổi tên.

-- Kiểu enum và giá trị enum
ALTER TYPE "WorkspacePlan" RENAME TO "OrganizationPlan";
ALTER TYPE "RoleScope" RENAME VALUE 'WORKSPACE' TO 'ORGANIZATION';
ALTER TYPE "PermissionScope" RENAME VALUE 'WORKSPACE' TO 'ORGANIZATION';

-- Bảng
ALTER TABLE "Workspace" RENAME TO "Organization";
ALTER TABLE "WorkspaceMembership" RENAME TO "OrganizationMembership";
ALTER TABLE "WorkspaceMembershipRole" RENAME TO "OrganizationMembershipRole";
ALTER TABLE "WorkspaceWorkflowScheme" RENAME TO "OrganizationWorkflowScheme";

DO $$
DECLARE
  r record;
  new_name text;
BEGIN
  -- Cột (mọi bảng trong schema public): workspaceId -> organizationId, canCreateWorkspace -> canCreateOrganization
  FOR r IN
    SELECT c.table_name AS tbl, c.column_name AS col
      FROM information_schema.columns c
      JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace AND k.relkind IN ('r', 'p')
     WHERE c.table_schema = 'public' AND c.column_name ILIKE '%workspace%'
     ORDER BY 1, 2
  LOOP
    new_name := replace(replace(replace(r.col, 'Workspace', 'Organization'), 'workspace', 'organization'), 'WORKSPACE', 'ORGANIZATION');
    EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', r.tbl, r.col, new_name);
  END LOOP;

  -- Ràng buộc khoá chính / khoá ngoại / duy nhất / kiểm tra (đổi tên cả chỉ mục đi kèm ràng buộc)
  FOR r IN
    SELECT cl.relname AS tbl, co.conname AS name
      FROM pg_constraint co
      JOIN pg_class cl ON cl.oid = co.conrelid
     WHERE cl.relnamespace = 'public'::regnamespace AND co.conname ILIKE '%workspace%' AND co.contype IN ('p', 'f', 'u', 'c')
     ORDER BY 1, 2
  LOOP
    new_name := replace(replace(replace(r.name, 'Workspace', 'Organization'), 'workspace', 'organization'), 'WORKSPACE', 'ORGANIZATION');
    -- Tên mới dài hơn 3 ký tự mỗi lần xuất hiện: phải còn trong giới hạn 63 ký tự của PostgreSQL, không thì dừng rõ ràng.
    IF length(new_name) > 63 THEN RAISE EXCEPTION 'Tên ràng buộc quá dài sau khi đổi: %', new_name; END IF;
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.name, new_name);
  END LOOP;

  -- Chỉ mục còn lại (unique/index do Prisma tạo, không thuộc ràng buộc)
  FOR r IN
    SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public' AND indexname ILIKE '%workspace%' ORDER BY 1
  LOOP
    new_name := replace(replace(replace(r.name, 'Workspace', 'Organization'), 'workspace', 'organization'), 'WORKSPACE', 'ORGANIZATION');
    IF length(new_name) > 63 THEN RAISE EXCEPTION 'Tên chỉ mục quá dài sau khi đổi: %', new_name; END IF;
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.name, new_name);
  END LOOP;
END
$$;

-- Chỉ mục một phần do `db:raw` tạo (tên viết tắt "ws"); chưa có (DB mới chưa chạy db:raw) thì bỏ qua — db:raw sẽ tạo thẳng tên mới.
ALTER INDEX IF EXISTS issue_ws_status_active RENAME TO issue_org_status_active;

-- Khoá quyền + tên vai trò hệ thống (seed-system-roles upsert theo tên mới, không tạo trùng)
UPDATE "Permission" SET "key" = 'organization:' || substring("key" from char_length('workspace:') + 1) WHERE "key" LIKE 'workspace:%';
UPDATE "Role" SET "name" = 'Organization ' || substring("name" from char_length('Workspace ') + 1) WHERE "isSystem" AND "name" LIKE 'Workspace %';
-- Tên hành động trong nhật ký kiểm toán (chỉ nhãn hành động; meta lịch sử giữ nguyên — người đọc `meta` chấp nhận cả hai khoá)
UPDATE "AuditLog" SET "action" = 'account.organization_added' WHERE "action" = 'account.workspace_added';
