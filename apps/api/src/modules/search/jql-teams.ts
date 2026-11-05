import type { JqlNode } from '@tirapro/shared';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { jqlUsesTeam, type JqlSubTeams } from './jql-compiler';

/**
 * Tra các team riêng của dự án trong tổ chức MỘT lần, chỉ khi JQL có `team` (không có → `undefined`, không tốn truy vấn). Không lọc theo
 * quyền xem: điều kiện `team` chỉ thu hẹp tập việc, còn phạm vi dự án người xem thấy do nơi gọi ghép (`visibleWhere`).
 */
export async function loadJqlSubTeams(
  prisma: Pick<PrismaService, 'projectSubTeam'>,
  organizationId: string,
  node: JqlNode | null,
): Promise<JqlSubTeams | undefined> {
  if (!jqlUsesTeam(node)) return undefined;
  const rows = await prisma.projectSubTeam.findMany({
    where: { project: { organizationId, deletedAt: null } },
    select: { id: true, projectId: true, name: true },
  });
  return { all: rows };
}
