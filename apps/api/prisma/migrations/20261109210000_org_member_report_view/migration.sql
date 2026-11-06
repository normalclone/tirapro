-- Dự án công khai chỉ xem: vai trò hệ thống "Organization Member" được xem báo cáo (report:view) ngay ở cấp tổ chức, vì vai trò dự án
-- mặc định (Developer) không còn tự cấp cho Organization Member. Chỉ THÊM quyền, idempotent.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r JOIN "Permission" p ON p."key" = 'report:view'
WHERE r."organizationId" IS NULL AND r."isSystem" = true AND r."name" = 'Organization Member'
ON CONFLICT DO NOTHING;
