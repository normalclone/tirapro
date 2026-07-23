-- CreateTable: nhiều vai trò cho 1 thành viên (workspace)
CREATE TABLE "WorkspaceMembershipRole" (
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "WorkspaceMembershipRole_pkey" PRIMARY KEY ("membershipId","roleId")
);

-- CreateTable: nhiều vai trò cho 1 thành viên (dự án)
CREATE TABLE "ProjectMembershipRole" (
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "ProjectMembershipRole_pkey" PRIMARY KEY ("membershipId","roleId")
);

-- CreateIndex
CREATE INDEX "WorkspaceMembershipRole_roleId_idx" ON "WorkspaceMembershipRole"("roleId");
CREATE INDEX "ProjectMembershipRole_roleId_idx" ON "ProjectMembershipRole"("roleId");

-- AddForeignKey
ALTER TABLE "WorkspaceMembershipRole" ADD CONSTRAINT "WorkspaceMembershipRole_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "WorkspaceMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembershipRole" ADD CONSTRAINT "WorkspaceMembershipRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMembershipRole" ADD CONSTRAINT "ProjectMembershipRole_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "ProjectMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMembershipRole" ADD CONSTRAINT "ProjectMembershipRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
