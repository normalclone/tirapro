-- L28: email người phụ trách Jira chưa là thành viên — nhớ để tự gán việc khi họ được thêm vào workspace.
-- CreateTable
CREATE TABLE "ImportPendingAssignee" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportPendingAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportPendingAssignee_issueId_key" ON "ImportPendingAssignee"("issueId");

-- CreateIndex
CREATE INDEX "ImportPendingAssignee_workspaceId_email_idx" ON "ImportPendingAssignee"("workspaceId", "email");

-- AddForeignKey
ALTER TABLE "ImportPendingAssignee" ADD CONSTRAINT "ImportPendingAssignee_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportPendingAssignee" ADD CONSTRAINT "ImportPendingAssignee_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

