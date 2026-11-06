-- DropIndex
DROP INDEX "Role_organizationId_name_scope_key";

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE INDEX "Role_projectId_idx" ON "Role"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_projectId_name_scope_key" ON "Role"("organizationId", "projectId", "name", "scope");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Mẫu vai trò (projectId NULL): NULL không chặn trùng trong unique 4 cột → chỉ mục duy nhất MỘT PHẦN giữ luật cũ
-- "tên vai trò duy nhất trong (tổ chức, cấp)". Prisma không biểu diễn được chỉ mục có WHERE nên nằm ở migration.
CREATE UNIQUE INDEX "Role_template_name_key" ON "Role"("organizationId", "name", "scope")
  WHERE "projectId" IS NULL AND "organizationId" IS NOT NULL;
