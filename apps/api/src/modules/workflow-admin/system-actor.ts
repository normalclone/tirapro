import type { Prisma } from '@prisma/client';
import { SYSTEM_USER_EMAIL } from '../../common/system-user';

/**
 * Người thực hiện của các dòng lịch sử do HỆ THỐNG ghi khi chuyển việc hàng loạt (đổi quy trình, xoá trạng thái, script
 * migrate): người dùng hệ thống `automation@tirapro.local` (tạo nếu chưa có, giống RuleEngineService.systemUserId) — không
 * gán cho quản trị viên/chủ tổ chức vì đó không phải thao tác từng việc của họ.
 */
export async function systemActorId(db: Pick<Prisma.TransactionClient, 'user'>): Promise<string> {
  const user = await db.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {},
    create: {
      email: SYSTEM_USER_EMAIL,
      displayName: 'Tirapro Automation',
      passwordHash: null,
      status: 'ACTIVE',
      isSystemAdmin: false,
    },
    select: { id: true },
  });
  return user.id;
}
