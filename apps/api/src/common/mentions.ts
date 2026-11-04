import type { Prisma } from '@prisma/client';

/**
 * Lọc danh sách id được @ xuống những người thật sự là thành viên (còn hoạt động) của organization.
 * Id lạ (đã rời tổ chức, bị vô hiệu hoá, gõ bậy) bị bỏ im lặng; giữ thứ tự gõ; loại `excludeUserId` (chính mình).
 */
export async function resolveMentionedMembers(
  db: Pick<Prisma.TransactionClient, 'organizationMembership'>,
  organizationId: string,
  ids: readonly string[],
  excludeUserId?: string,
): Promise<string[]> {
  const wanted = [...new Set(ids)].filter((id) => id && id !== excludeUserId);
  if (!wanted.length) return [];
  const rows = await db.organizationMembership.findMany({
    where: { organizationId, userId: { in: wanted }, user: { status: { not: 'DEACTIVATED' } } },
    select: { userId: true },
  });
  const ok = new Set(rows.map((r) => r.userId));
  return wanted.filter((id) => ok.has(id));
}
