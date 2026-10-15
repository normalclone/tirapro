-- Rà bộ quyền mặc định của vai trò hệ thống (nguồn sự thật: SYSTEM_ROLE_PERMISSIONS ở packages/types).
-- Chỉ THÊM quyền cho vai trò hệ thống (isSystem AND workspaceId IS NULL); vai trò tuỳ biến cùng tên không bị đụng,
-- không thu hồi quyền nào → an toàn khi chạy lại. Thêm cặp mới = thêm một dòng VALUES (cùng kiểu với migration khác).
--   Scrum Master: tạo việc + triage (trước đây có sprint/board nhưng không tạo được việc).
--   Product Owner: chuyển trạng thái / kéo thẻ (route /move cần issue:transition).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM (VALUES
    ('Scrum Master', 'issue:create'),
    ('Scrum Master', 'issue:triage'),
    ('Product Owner', 'issue:transition')
) AS g("roleName", "permissionKey")
JOIN "Role" r
  ON r."name" = g."roleName" AND r."scope" = 'PROJECT' AND r."isSystem" = true AND r."workspaceId" IS NULL
JOIN "Permission" p ON p."key" = g."permissionKey"
ON CONFLICT DO NOTHING;

UPDATE "Role"
SET "description" = 'Bộ quyền cơ bản cho lập trình viên (bản cũ — thường dùng vai trò "Developer")'
WHERE "name" = 'Project Developer' AND "isSystem" = true AND "workspaceId" IS NULL;
