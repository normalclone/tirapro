-- Sức khoẻ dự án: quản trị dự án có thể ghi đè giá trị tự tính, kèm ghi chú.
CREATE TYPE "ProjectHealth" AS ENUM ('GREEN', 'YELLOW', 'RED');

ALTER TABLE "Project"
  ADD COLUMN "healthOverride" "ProjectHealth",
  ADD COLUMN "healthNote" VARCHAR(500),
  ADD COLUMN "healthUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "healthUpdatedById" TEXT;

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_healthUpdatedById_fkey"
  FOREIGN KEY ("healthUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
