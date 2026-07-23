-- Add nullable avatar/logo URL to Workspace (matches User.avatarUrl, Project.avatarUrl).
ALTER TABLE "Workspace" ADD COLUMN "avatarUrl" TEXT;
