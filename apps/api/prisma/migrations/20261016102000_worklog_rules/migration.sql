-- AlterEnum
ALTER TYPE "HistoryField" ADD VALUE IF NOT EXISTS 'TIME_SPENT';

-- CreateEnum
CREATE TYPE "RuleTrigger" AS ENUM ('ISSUE_CREATED', 'ISSUE_TRANSITIONED', 'ISSUE_UPDATED', 'COMMENT_ADDED', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "RuleRunStatus" AS ENUM ('SUCCESS', 'SKIPPED', 'FAILED');

-- DropIndex (thay bằng index kép theo thời gian bắt đầu)
DROP INDEX "WorkLog_issueId_idx";

-- CreateIndex
CREATE INDEX "WorkLog_issueId_startedAt_idx" ON "WorkLog"("issueId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkLog_authorId_startedAt_idx" ON "WorkLog"("authorId", "startedAt");

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "RuleTrigger" NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "issueId" TEXT,
    "status" "RuleRunStatus" NOT NULL,
    "log" JSONB NOT NULL DEFAULT '[]',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_enabled_trigger_idx" ON "AutomationRule"("workspaceId", "enabled", "trigger");

-- CreateIndex
CREATE INDEX "AutomationRun_ruleId_createdAt_idx" ON "AutomationRun"("ruleId", "createdAt");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quyền mới (idempotent): bản đã seed từ trước không cần chạy lại seed.ts.
INSERT INTO "Permission" ("id", "key", "description", "scope") VALUES
    ('perm_worklog_create', 'worklog:create', 'Ghi nhận thời gian làm việc', 'PROJECT'),
    ('perm_worklog_update', 'worklog:update', 'Sửa worklog của mình', 'PROJECT'),
    ('perm_worklog_delete', 'worklog:delete', 'Xoá worklog của mình', 'PROJECT'),
    ('perm_automation_manage', 'automation:manage', 'Quản lý quy tắc tự động hoá (khi/nếu/thì)', 'PROJECT')
ON CONFLICT ("key") DO NOTHING;

-- Vai trò nào đã có issue:edit thì được ghi/sửa/xoá worklog.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", np."id"
FROM "RolePermission" rp
JOIN "Permission" ep ON ep."id" = rp."permissionId" AND ep."key" = 'issue:edit'
JOIN "Permission" np ON np."key" IN ('worklog:create', 'worklog:update', 'worklog:delete')
ON CONFLICT DO NOTHING;

-- Vai trò quản trị (project:admin / workspace:admin) được quản lý quy tắc automation.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", np."id"
FROM "RolePermission" rp
JOIN "Permission" ap ON ap."id" = rp."permissionId" AND ap."key" IN ('project:admin', 'workspace:admin')
JOIN "Permission" np ON np."key" = 'automation:manage'
ON CONFLICT DO NOTHING;
