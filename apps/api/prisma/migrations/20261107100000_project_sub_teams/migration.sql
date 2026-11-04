-- Team riêng trong dự án (lọc / nhóm / JQL `team`; không cấp quyền). Chỉ cộng thêm.

-- CreateTable
CREATE TABLE "ProjectSubTeam" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSubTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSubTeamMember" (
    "subTeamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSubTeamMember_pkey" PRIMARY KEY ("subTeamId","userId")
);

-- CreateIndex
CREATE INDEX "ProjectSubTeam_projectId_idx" ON "ProjectSubTeam"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSubTeam_projectId_name_key" ON "ProjectSubTeam"("projectId", "name");

-- CreateIndex
CREATE INDEX "ProjectSubTeamMember_userId_idx" ON "ProjectSubTeamMember"("userId");

-- AddForeignKey
ALTER TABLE "ProjectSubTeam" ADD CONSTRAINT "ProjectSubTeam_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSubTeamMember" ADD CONSTRAINT "ProjectSubTeamMember_subTeamId_fkey" FOREIGN KEY ("subTeamId") REFERENCES "ProjectSubTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSubTeamMember" ADD CONSTRAINT "ProjectSubTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
