-- Thêm hai loại liên kết mới cho mọi workspace hiện có (workspace tạo mới lấy từ DEFAULT_LINK_TYPES).
-- Idempotent (WHERE NOT EXISTS); id dạng chuỗi giống CUID, sinh bằng md5 nên không cần extension.
INSERT INTO "LinkType" ("id", "workspaceId", "name", "outwardName", "inwardName", "isSystem")
SELECT 'c' || substr(md5(random()::text || w."id" || 'causes'), 1, 24), w."id", 'Causes', 'causes', 'is caused by', true
FROM "Workspace" w
WHERE NOT EXISTS (SELECT 1 FROM "LinkType" l WHERE l."workspaceId" = w."id" AND l."name" = 'Causes');

INSERT INTO "LinkType" ("id", "workspaceId", "name", "outwardName", "inwardName", "isSystem")
SELECT 'c' || substr(md5(random()::text || w."id" || 'tests'), 1, 24), w."id", 'Tests', 'tests', 'is tested by', true
FROM "Workspace" w
WHERE NOT EXISTS (SELECT 1 FROM "LinkType" l WHERE l."workspaceId" = w."id" AND l."name" = 'Tests');
