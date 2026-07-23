-- Gỡ liên kết issue ↔ team (task không còn thuộc nhóm). Team vẫn dùng để tổ chức thành viên.
-- DropForeignKey
ALTER TABLE "Issue" DROP CONSTRAINT IF EXISTS "Issue_teamId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Issue_teamId_idx";

-- DropColumn
ALTER TABLE "Issue" DROP COLUMN IF EXISTS "teamId";
