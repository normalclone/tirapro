-- Chia sẻ bộ lọc theo NHIỀU dự án + người cụ thể (thay `visibility` ba mức + `sharedProjectId`).
-- Chuyển dữ liệu cũ:
--   PROJECT + sharedProjectId            → 1 dòng chia sẻ dự án (nếu dự án còn sống);
--   WORKSPACE, và PROJECT không có dự án → chia sẻ cho MỌI dự án còn sống mà CHỦ bộ lọc là thành viên (cùng workspace);
--   bộ lọc nào sau đó không có dòng chia sẻ nào (vd chủ không thuộc dự án nào) → PRIVATE.
-- Enum mới: PRIVATE | SHARED (SHARED = có ít nhất một dòng chia sẻ).

-- CreateTable
CREATE TABLE "SavedFilterProjectShare" (
    "filterId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedFilterProjectShare_pkey" PRIMARY KEY ("filterId","projectId")
);

-- CreateTable
CREATE TABLE "SavedFilterUserShare" (
    "filterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedFilterUserShare_pkey" PRIMARY KEY ("filterId","userId")
);

-- CreateIndex
CREATE INDEX "SavedFilterProjectShare_projectId_idx" ON "SavedFilterProjectShare"("projectId");

-- CreateIndex
CREATE INDEX "SavedFilterUserShare_userId_idx" ON "SavedFilterUserShare"("userId");

-- AddForeignKey
ALTER TABLE "SavedFilterProjectShare" ADD CONSTRAINT "SavedFilterProjectShare_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "SavedFilter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilterProjectShare" ADD CONSTRAINT "SavedFilterProjectShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilterUserShare" ADD CONSTRAINT "SavedFilterUserShare_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "SavedFilter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilterUserShare" ADD CONSTRAINT "SavedFilterUserShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dữ liệu: PROJECT + dự án
INSERT INTO "SavedFilterProjectShare" ("filterId", "projectId")
SELECT f."id", f."sharedProjectId"
FROM "SavedFilter" f
JOIN "Project" p ON p."id" = f."sharedProjectId" AND p."deletedAt" IS NULL
WHERE f."visibility" = 'PROJECT' AND f."sharedProjectId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Dữ liệu: WORKSPACE (và PROJECT cũ không gắn dự án = "cả workspace thấy") → mọi dự án sống chủ bộ lọc là thành viên
INSERT INTO "SavedFilterProjectShare" ("filterId", "projectId")
SELECT DISTINCT f."id", pm."projectId"
FROM "SavedFilter" f
JOIN "ProjectMembership" pm ON pm."userId" = f."ownerId"
JOIN "Project" p ON p."id" = pm."projectId" AND p."deletedAt" IS NULL AND p."workspaceId" = f."workspaceId"
WHERE f."visibility" = 'WORKSPACE' OR (f."visibility" = 'PROJECT' AND f."sharedProjectId" IS NULL)
ON CONFLICT DO NOTHING;

-- Enum mới (Postgres không xoá được giá trị enum): đổi cột sang text, chuyển giá trị, rồi tạo lại kiểu.
ALTER TABLE "SavedFilter" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "SavedFilter" ALTER COLUMN "visibility" TYPE TEXT USING "visibility"::TEXT;
UPDATE "SavedFilter" f
SET "visibility" = CASE
  WHEN EXISTS (SELECT 1 FROM "SavedFilterProjectShare" s WHERE s."filterId" = f."id") THEN 'SHARED'
  ELSE 'PRIVATE'
END;
DROP TYPE "FilterVisibility";
CREATE TYPE "FilterVisibility" AS ENUM ('PRIVATE', 'SHARED');
ALTER TABLE "SavedFilter" ALTER COLUMN "visibility" TYPE "FilterVisibility" USING "visibility"::"FilterVisibility";
ALTER TABLE "SavedFilter" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';

-- Bỏ cột cũ
ALTER TABLE "SavedFilter" DROP CONSTRAINT "SavedFilter_sharedProjectId_fkey";
ALTER TABLE "SavedFilter" DROP COLUMN "sharedProjectId";
