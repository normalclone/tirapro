-- Dashboard data scope (separate from the sharing scope DashboardScope).
-- Mapping for existing rows: every dashboard becomes ORG. Today a widget without its own projectId
-- reads organization-wide numbers filtered by the viewer's visible projects, and Dashboard.projectId only
-- controls who may SEE the dashboard (sharing), never the numbers. ORG keeps every existing widget
-- resolving to exactly what it fetched before; widgets with their own projectId are untouched.
CREATE TYPE "DashboardDataScope" AS ENUM ('PROJECT', 'GROUP', 'ORG');

ALTER TABLE "Dashboard"
  ADD COLUMN "dataScope" "DashboardDataScope" NOT NULL DEFAULT 'ORG',
  ADD COLUMN "scopeProjectId" TEXT,
  ADD COLUMN "scopeProgramId" TEXT;

CREATE INDEX "Dashboard_scopeProjectId_idx" ON "Dashboard"("scopeProjectId");
CREATE INDEX "Dashboard_scopeProgramId_idx" ON "Dashboard"("scopeProgramId");

ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_scopeProjectId_fkey"
  FOREIGN KEY ("scopeProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_scopeProgramId_fkey"
  FOREIGN KEY ("scopeProgramId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
