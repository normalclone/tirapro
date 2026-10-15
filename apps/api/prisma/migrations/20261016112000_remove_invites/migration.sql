-- Gỡ luồng lời mời. Xoá MỌI thư mời trong hộp thư đi (mọi trạng thái): PENDING/SENDING chứa liên kết dùng-một-lần
-- tới route đã gỡ (đừng gửi); SENT/FAILED còn email người nhận, tên workspace/người mời và có thể cả token thô.
DELETE FROM "EmailOutbox" WHERE "template" = 'invite';

-- DropForeignKey
ALTER TABLE "InviteToken" DROP CONSTRAINT "InviteToken_workspaceId_fkey";

-- DropTable
DROP TABLE "InviteToken";

