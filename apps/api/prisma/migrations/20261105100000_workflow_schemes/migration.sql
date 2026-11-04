-- CreateTable
CREATE TABLE "WorkspaceWorkflowScheme" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "issueTypeId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceWorkflowScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectWorkflowOverride" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "issueTypeId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWorkflowOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceWorkflowScheme_workflowId_idx" ON "WorkspaceWorkflowScheme"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceWorkflowScheme_workspaceId_issueTypeId_key" ON "WorkspaceWorkflowScheme"("workspaceId", "issueTypeId");

-- CreateIndex
CREATE INDEX "ProjectWorkflowOverride_workflowId_idx" ON "ProjectWorkflowOverride"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWorkflowOverride_projectId_issueTypeId_key" ON "ProjectWorkflowOverride"("projectId", "issueTypeId");

-- AddForeignKey
ALTER TABLE "WorkspaceWorkflowScheme" ADD CONSTRAINT "WorkspaceWorkflowScheme_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceWorkflowScheme" ADD CONSTRAINT "WorkspaceWorkflowScheme_issueTypeId_fkey" FOREIGN KEY ("issueTypeId") REFERENCES "IssueType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceWorkflowScheme" ADD CONSTRAINT "WorkspaceWorkflowScheme_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWorkflowOverride" ADD CONSTRAINT "ProjectWorkflowOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWorkflowOverride" ADD CONSTRAINT "ProjectWorkflowOverride_issueTypeId_fkey" FOREIGN KEY ("issueTypeId") REFERENCES "IssueType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWorkflowOverride" ADD CONSTRAINT "ProjectWorkflowOverride_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

