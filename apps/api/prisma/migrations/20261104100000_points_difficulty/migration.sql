-- Điểm việc tự tính theo Loại × Độ khó × Ưu tiên: độ khó + cờ ghi đè tay + bảng hệ số toàn hệ thống.
-- Việc cũ nhận MEDIUM / pointsManual=false qua giá trị mặc định của cột; điểm cũ được TÍNH LẠI bằng script vận hành sau migrate
-- (deploy.sh), KHÔNG tính trong SQL.
CREATE TYPE "IssueDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'VERY_HARD');

ALTER TABLE "Issue" ADD COLUMN "difficulty" "IssueDifficulty" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "Issue" ADD COLUMN "pointsManual" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PointsFormulaConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "formula" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PointsFormulaConfig_pkey" PRIMARY KEY ("id")
);

-- Bảng mặc định = DEFAULT_POINTS_FORMULA (@tirapro/shared). Idempotent: không đè bản SA đã chỉnh.
INSERT INTO "PointsFormulaConfig" ("id", "formula", "updatedAt")
VALUES (
  'default',
  '{"base":{"SUBTASK":1,"TASK":2,"BUG":2,"STORY":3},"difficulty":{"EASY":1,"MEDIUM":2,"HARD":3,"VERY_HARD":5},"priority":{"Lowest":1,"Low":1,"Medium":1,"High":1.5,"Highest":2}}'::jsonb,
  (now() AT TIME ZONE 'UTC')
)
ON CONFLICT ("id") DO NOTHING;
