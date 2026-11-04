-- Team theo dự án: gắn team của tổ chức vào dự án (ProjectTeamLink) và ghi NGUỒN của từng vai trò dự án.
-- `ProjectMembershipRole.direct` (mặc định true: mọi dòng cũ = gán trực tiếp) + bảng nguồn "nhờ team". Chỉ thêm cột/bảng, không đổi dữ liệu cũ.

-- AlterTable
ALTER TABLE "ProjectMembershipRole" ADD COLUMN     "direct" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ProjectMembershipRoleTeam" (
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMembershipRoleTeam_pkey" PRIMARY KEY ("membershipId","roleId","teamId")
);

-- CreateTable
CREATE TABLE "ProjectTeamLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "roleIds" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTeamLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMembershipRoleTeam_teamId_idx" ON "ProjectMembershipRoleTeam"("teamId");

-- CreateIndex
CREATE INDEX "ProjectTeamLink_teamId_idx" ON "ProjectTeamLink"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTeamLink_projectId_teamId_key" ON "ProjectTeamLink"("projectId", "teamId");

-- AddForeignKey
ALTER TABLE "ProjectMembershipRoleTeam" ADD CONSTRAINT "ProjectMembershipRoleTeam_membershipId_roleId_fkey" FOREIGN KEY ("membershipId", "roleId") REFERENCES "ProjectMembershipRole"("membershipId", "roleId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMembershipRoleTeam" ADD CONSTRAINT "ProjectMembershipRoleTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeamLink" ADD CONSTRAINT "ProjectTeamLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeamLink" ADD CONSTRAINT "ProjectTeamLink_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
