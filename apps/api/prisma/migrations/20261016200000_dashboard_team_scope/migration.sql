-- L5: dashboard tuỳ biến chia sẻ theo nhóm (Team) + ba loại ô mới cho lãnh đạo.
-- ADD VALUE chạy được trong transaction (PG ≥ 12) miễn là giá trị mới chưa được dùng ngay trong migration này.
ALTER TYPE "DashboardScope" ADD VALUE IF NOT EXISTS 'TEAM';
ALTER TYPE "WidgetType" ADD VALUE IF NOT EXISTS 'TOP_RISKS';
ALTER TYPE "WidgetType" ADD VALUE IF NOT EXISTS 'SLOW_GOALS';
ALTER TYPE "WidgetType" ADD VALUE IF NOT EXISTS 'OVERLOAD';

ALTER TABLE "Dashboard" ADD COLUMN "teamId" TEXT;

ALTER TABLE "Dashboard"
  ADD CONSTRAINT "Dashboard_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Dashboard_teamId_scope_idx" ON "Dashboard"("teamId", "scope");
