-- wiki:manage thành quyền cấp DỰ ÁN; vai BA/PO/SM/Project Admin/Developer/Tester được viết wiki của dự án.
-- Idempotent: chạy lại hoặc chạy sau migration rà quyền vai trò khác đều an toàn.
UPDATE "Permission" SET "scope" = 'PROJECT', "description" = 'Tạo/sửa tài liệu nội bộ (wiki) của dự án' WHERE "key" = 'wiki:manage';

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r JOIN "Permission" p ON p."key" = 'wiki:manage'
WHERE r."workspaceId" IS NULL AND r."isSystem" = true
  AND r."name" IN ('Business Analyst', 'Product Owner', 'Scrum Master', 'Project Admin', 'Developer', 'Tester')
ON CONFLICT DO NOTHING;

-- Vai quản trị tuỳ biến (đã có project:admin hoặc workspace:admin) cũng được quản lý wiki.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", np."id"
FROM "RolePermission" rp
JOIN "Permission" ap ON ap."id" = rp."permissionId" AND ap."key" IN ('project:admin', 'workspace:admin')
JOIN "Permission" np ON np."key" = 'wiki:manage'
ON CONFLICT DO NOTHING;
