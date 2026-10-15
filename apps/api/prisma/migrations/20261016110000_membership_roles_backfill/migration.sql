-- Vá dữ liệu: membership tạo bởi đăng ký/tạo workspace/tạo dự án trước đây chỉ có cột roleId,
-- không có dòng bảng nối nên UI hiện "Chưa có vai trò" / "Chỉ xem (riêng)". Chỉ THÊM dòng cho
-- membership chưa có dòng nối nào (idempotent, không đụng membership đã có nhiều vai trò).
INSERT INTO "WorkspaceMembershipRole" ("membershipId", "roleId")
SELECT m."id", m."roleId" FROM "WorkspaceMembership" m
WHERE NOT EXISTS (SELECT 1 FROM "WorkspaceMembershipRole" r WHERE r."membershipId" = m."id")
ON CONFLICT DO NOTHING;

INSERT INTO "ProjectMembershipRole" ("membershipId", "roleId")
SELECT m."id", m."roleId" FROM "ProjectMembership" m
WHERE NOT EXISTS (SELECT 1 FROM "ProjectMembershipRole" r WHERE r."membershipId" = m."id")
ON CONFLICT DO NOTHING;
