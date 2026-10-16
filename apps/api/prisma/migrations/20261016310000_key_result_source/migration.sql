-- L25: Key Result tự đo — nguồn số liệu + cấu hình
CREATE TYPE "KeyResultSource" AS ENUM ('MANUAL', 'OPEN_BUGS', 'SPRINT_COMPLETION', 'ISSUE_COUNT_JQL');

ALTER TABLE "KeyResult" ADD COLUMN "source" "KeyResultSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "sourceConfig" JSONB;
