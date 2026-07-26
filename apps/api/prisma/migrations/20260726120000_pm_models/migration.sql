-- Mở rộng mô hình quản lý: Gantt phụ thuộc/mốc/baseline, nguồn lực, program,
-- OKR, RAID, SLA, test management, việc lặp lại/mẫu/checklist, wiki, khách hàng,
-- và người tham gia issue.
-- LƯU Ý: KHÔNG đụng tới Issue.searchVector / IssueEmbedding.embedding và 3 index
-- pgvector/FTS (tạo ngoài Prisma qua prisma/sql/01_pgvector_fts.sql).

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FS', 'SS', 'FF', 'SF');

-- CreateEnum
CREATE TYPE "RaidKind" AS ENUM ('RISK', 'ASSUMPTION', 'ISSUE', 'DEPENDENCY');

-- CreateEnum
CREATE TYPE "RaidStatus" AS ENUM ('OPEN', 'MITIGATING', 'CLOSED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "TestResult" AS ENUM ('UNTESTED', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ObjectiveStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "KeyResultUnit" AS ENUM ('NUMBER', 'PERCENT', 'CURRENCY');

-- CreateEnum
CREATE TYPE "RecurrenceFreq" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "TimeOffKind" AS ENUM ('LEAVE', 'HOLIDAY', 'OTHER');






-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "programId" TEXT;

-- CreateTable
CREATE TABLE "IssueParticipant" (
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueParticipant_pkey" PRIMARY KEY ("issueId","userId")
);

-- CreateTable
CREATE TABLE "IssueDependency" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FS',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanBaseline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PlanBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanBaselineItem" (
    "baselineId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),

    CONSTRAINT "PlanBaselineItem_pkey" PRIMARY KEY ("baselineId","issueId")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL DEFAULT 100,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOff" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "TimeOffKind" NOT NULL DEFAULT 'LEAVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "ownerId" TEXT,
    "startDate" TIMESTAMP(3),
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Objective" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "period" TEXT NOT NULL,
    "status" "ObjectiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Objective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyResult" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "KeyResultUnit" NOT NULL DEFAULT 'NUMBER',
    "startValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectiveIssue" (
    "objectiveId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,

    CONSTRAINT "ObjectiveIssue_pkey" PRIMARY KEY ("objectiveId","issueId")
);

-- CreateTable
CREATE TABLE "RaidItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" "RaidKind" NOT NULL DEFAULT 'RISK',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "probability" INTEGER NOT NULL DEFAULT 3,
    "impact" INTEGER NOT NULL DEFAULT 3,
    "status" "RaidStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT,
    "mitigation" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaidItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "priorityId" TEXT,
    "responseMins" INTEGER NOT NULL,
    "resolveMins" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueSla" (
    "issueId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "responseDueAt" TIMESTAMP(3) NOT NULL,
    "resolveDueAt" TIMESTAMP(3) NOT NULL,
    "firstRespondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "responseBreached" BOOLEAN NOT NULL DEFAULT false,
    "resolveBreached" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "IssueSla_pkey" PRIMARY KEY ("issueId")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "precondition" TEXT,
    "steps" TEXT,
    "expected" TEXT,
    "folder" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseIssue" (
    "testCaseId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,

    CONSTRAINT "TestCaseIssue_pkey" PRIMARY KEY ("testCaseId","issueId")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestExecution" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "result" "TestResult" NOT NULL DEFAULT 'UNTESTED',
    "note" TEXT,
    "bugIssueId" TEXT,
    "executedById" TEXT,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "TestExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "freq" "RecurrenceFreq" NOT NULL DEFAULT 'WEEKLY',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekday" INTEGER,
    "monthDay" INTEGER,
    "hour" INTEGER NOT NULL DEFAULT 8,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "value" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueParticipant_userId_idx" ON "IssueParticipant"("userId");

-- CreateIndex
CREATE INDEX "IssueDependency_projectId_idx" ON "IssueDependency"("projectId");

-- CreateIndex
CREATE INDEX "IssueDependency_successorId_idx" ON "IssueDependency"("successorId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueDependency_predecessorId_successorId_key" ON "IssueDependency"("predecessorId", "successorId");

-- CreateIndex
CREATE INDEX "Milestone_projectId_dueDate_idx" ON "Milestone"("projectId", "dueDate");

-- CreateIndex
CREATE INDEX "PlanBaseline_projectId_capturedAt_idx" ON "PlanBaseline"("projectId", "capturedAt");

-- CreateIndex
CREATE INDEX "PlanBaselineItem_issueId_idx" ON "PlanBaselineItem"("issueId");

-- CreateIndex
CREATE INDEX "Allocation_projectId_idx" ON "Allocation"("projectId");

-- CreateIndex
CREATE INDEX "Allocation_userId_startDate_idx" ON "Allocation"("userId", "startDate");

-- CreateIndex
CREATE INDEX "TimeOff_workspaceId_startDate_idx" ON "TimeOff"("workspaceId", "startDate");

-- CreateIndex
CREATE INDEX "TimeOff_userId_idx" ON "TimeOff"("userId");

-- CreateIndex
CREATE INDEX "Program_workspaceId_idx" ON "Program"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Program_workspaceId_name_key" ON "Program"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Objective_workspaceId_period_idx" ON "Objective"("workspaceId", "period");

-- CreateIndex
CREATE INDEX "KeyResult_objectiveId_idx" ON "KeyResult"("objectiveId");

-- CreateIndex
CREATE INDEX "ObjectiveIssue_issueId_idx" ON "ObjectiveIssue"("issueId");

-- CreateIndex
CREATE INDEX "RaidItem_workspaceId_kind_idx" ON "RaidItem"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "RaidItem_projectId_status_idx" ON "RaidItem"("projectId", "status");

-- CreateIndex
CREATE INDEX "SlaPolicy_workspaceId_idx" ON "SlaPolicy"("workspaceId");

-- CreateIndex
CREATE INDEX "IssueSla_policyId_idx" ON "IssueSla"("policyId");

-- CreateIndex
CREATE INDEX "IssueSla_resolveDueAt_idx" ON "IssueSla"("resolveDueAt");

-- CreateIndex
CREATE INDEX "TestCase_projectId_folder_idx" ON "TestCase"("projectId", "folder");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_projectId_key_key" ON "TestCase"("projectId", "key");

-- CreateIndex
CREATE INDEX "TestCaseIssue_issueId_idx" ON "TestCaseIssue"("issueId");

-- CreateIndex
CREATE INDEX "TestRun_projectId_startedAt_idx" ON "TestRun"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "TestExecution_testCaseId_idx" ON "TestExecution"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "TestExecution_runId_testCaseId_key" ON "TestExecution"("runId", "testCaseId");

-- CreateIndex
CREATE INDEX "IssueTemplate_workspaceId_idx" ON "IssueTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "RecurringIssue_active_nextRunAt_idx" ON "RecurringIssue"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "RecurringIssue_projectId_idx" ON "RecurringIssue"("projectId");

-- CreateIndex
CREATE INDEX "ChecklistItem_issueId_order_idx" ON "ChecklistItem"("issueId", "order");

-- CreateIndex
CREATE INDEX "WikiPage_workspaceId_projectId_idx" ON "WikiPage"("workspaceId", "projectId");

-- CreateIndex
CREATE INDEX "WikiPage_parentId_idx" ON "WikiPage"("parentId");

-- CreateIndex
CREATE INDEX "Client_workspaceId_idx" ON "Client"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_workspaceId_name_key" ON "Client"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Contract_clientId_idx" ON "Contract"("clientId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueParticipant" ADD CONSTRAINT "IssueParticipant_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueParticipant" ADD CONSTRAINT "IssueParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDependency" ADD CONSTRAINT "IssueDependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDependency" ADD CONSTRAINT "IssueDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDependency" ADD CONSTRAINT "IssueDependency_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBaseline" ADD CONSTRAINT "PlanBaseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBaselineItem" ADD CONSTRAINT "PlanBaselineItem_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "PlanBaseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBaselineItem" ADD CONSTRAINT "PlanBaselineItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResult" ADD CONSTRAINT "KeyResult_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveIssue" ADD CONSTRAINT "ObjectiveIssue_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveIssue" ADD CONSTRAINT "ObjectiveIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaidItem" ADD CONSTRAINT "RaidItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaidItem" ADD CONSTRAINT "RaidItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaidItem" ADD CONSTRAINT "RaidItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueSla" ADD CONSTRAINT "IssueSla_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueSla" ADD CONSTRAINT "IssueSla_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SlaPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseIssue" ADD CONSTRAINT "TestCaseIssue_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseIssue" ADD CONSTRAINT "TestCaseIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestExecution" ADD CONSTRAINT "TestExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestExecution" ADD CONSTRAINT "TestExecution_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueTemplate" ADD CONSTRAINT "IssueTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueTemplate" ADD CONSTRAINT "IssueTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringIssue" ADD CONSTRAINT "RecurringIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WikiPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

