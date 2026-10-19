-- Quy trình tự sinh khi tạo dự án trước đây trùng tên mẫu → thêm mã dự án để phân biệt.
-- Chỉ đụng quy trình của dự án mang tên mẫu mặc định (không đụng quy trình người dùng tự đặt).
UPDATE "Workflow" w
SET "name" = w."name" || ' (' || p."key" || ')'
FROM "Project" p
WHERE p."defaultWorkflowId" = w."id"
  AND w."isTemplate" = false
  AND w."name" IN ('Scrum mặc định', 'Kanban mặc định', 'Quản lý yêu cầu');

-- Mô tả vai trò "Project Developer" nói đúng nhãn hiển thị mới ("Lập trình viên").
UPDATE "Role"
SET "description" = 'Bộ quyền cơ bản cho lập trình viên (bản cũ — thường dùng vai trò "Lập trình viên")'
WHERE "name" = 'Project Developer' AND "scope" = 'PROJECT' AND "isSystem" = true AND "workspaceId" IS NULL;
