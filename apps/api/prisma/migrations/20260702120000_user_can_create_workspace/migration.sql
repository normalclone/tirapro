-- AlterTable: quyền tạo workspace do admin hệ thống cấp
ALTER TABLE "User" ADD COLUMN "canCreateWorkspace" BOOLEAN NOT NULL DEFAULT false;
