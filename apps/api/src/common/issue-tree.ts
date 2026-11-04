import { Prisma } from '@prisma/client';
import type { PrismaService } from '../infra/prisma/prisma.service';

/** Độ sâu tối đa khi đi xuống cây việc (cây không có vòng; chặn để chắc chắn dừng). */
const MAX_TREE_DEPTH = 20;

/** Một việc con (cháu...) chưa xoá của một nhóm việc gốc. */
export interface TreeDescendant {
  id: string;
  parentId: string;
  sprintId: string | null;
}

/**
 * Mọi việc con/cháu CHƯA XOÁ của `rootIds` (không gồm chính `rootIds`), duyệt theo tầng. Dùng để việc con đi theo sprint
 * của việc cha và để khoá cả nhánh trước khi ghi cha.
 */
export async function liveDescendants(
  db: Prisma.TransactionClient | PrismaService,
  rootIds: string[],
): Promise<TreeDescendant[]> {
  const out: TreeDescendant[] = [];
  const seen = new Set(rootIds);
  let frontier = [...new Set(rootIds)];
  for (let depth = 0; depth < MAX_TREE_DEPTH && frontier.length > 0; depth++) {
    const rows = await db.issue.findMany({
      where: { parentId: { in: frontier }, deletedAt: null },
      select: { id: true, parentId: true, sprintId: true },
    });
    frontier = [];
    for (const r of rows) {
      if (seen.has(r.id) || !r.parentId) continue;
      seen.add(r.id);
      out.push({ id: r.id, parentId: r.parentId, sprintId: r.sprintId });
      frontier.push(r.id);
    }
  }
  return out;
}

/**
 * Khoá (FOR UPDATE, theo thứ tự id) các dòng của `ids` — gọi TRƯỚC khi ghi việc cha để thứ tự khoá luôn là việc con → cha
 * (cùng thứ tự với cộng điểm việc cha), không bắt chéo với người đang sửa việc con.
 */
export async function lockIssues(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw`SELECT "id" FROM "Issue" WHERE "id" IN (${Prisma.join(sorted)}) ORDER BY "id" FOR UPDATE`;
}
