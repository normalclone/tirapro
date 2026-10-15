-- Gỡ luồng lời mời. Thư mời đang chờ gửi chứa liên kết dùng-một-lần tới route đã gỡ → huỷ, đừng gửi.
DELETE FROM "EmailOutbox" WHERE "template" = 'invite' AND "status" IN ('PENDING', 'SENDING');

-- DropForeignKey
ALTER TABLE "InviteToken" DROP CONSTRAINT "InviteToken_workspaceId_fkey";

-- DropTable
DROP TABLE "InviteToken";

