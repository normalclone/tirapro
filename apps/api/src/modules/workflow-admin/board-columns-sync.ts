import type { Prisma } from '@prisma/client';
import type { StatusCategory } from '@tirapro/types';

interface ColumnInfo {
  id: string;
  /** Nhóm của các trạng thái đang nằm trong cột (có thể trùng). */
  categories: StatusCategory[];
}

/**
 * Cột nhận trạng thái mới theo NHÓM: cột đầu tiên (theo thứ tự cột) đang chứa trạng thái cùng nhóm — tức cột mặc định
 * To Do / In Progress / Done của bảng. Bảng không có trạng thái nhóm đó: TODO → cột đầu, DONE → cột cuối, IN_PROGRESS →
 * cột liền sau cột đầu (hoặc cột đầu nếu chỉ có một). Cột phải sắp theo `order` tăng dần; rỗng → null.
 */
export function pickColumnForCategory(
  columns: ColumnInfo[],
  category: StatusCategory,
): string | null {
  if (columns.length === 0) return null;
  const same = columns.find((c) => c.categories.includes(category));
  if (same) return same.id;
  if (category === 'TODO') return columns[0]!.id;
  if (category === 'DONE') return columns[columns.length - 1]!.id;
  return (columns[1] ?? columns[0])!.id;
}

/**
 * Sau khi đổi quy trình của một dự án (cấu hình tổ chức / ghi đè): thêm vào MỖI bảng của dự án các trạng thái của quy
 * trình đang dùng mà chưa nằm trong cột nào — để bảng vẫn lưu được (`setColumns` bắt buộc phủ mọi trạng thái) và không
 * thẻ nào biến mất. Không bao giờ gỡ trạng thái cũ khỏi cột. Chạy trong transaction của bên gọi; idempotent.
 */
export async function appendMissingBoardStatuses(
  tx: Prisma.TransactionClient,
  projectId: string,
  workflowIds: string[],
): Promise<{ added: number }> {
  if (workflowIds.length === 0) return { added: 0 };
  const required = await tx.status.findMany({
    where: { workflowId: { in: workflowIds } },
    orderBy: [{ workflowId: 'asc' }, { order: 'asc' }],
    select: { id: true, category: true },
  });
  if (required.length === 0) return { added: 0 };
  const boards = await tx.board.findMany({
    where: { projectId, deletedAt: null },
    select: {
      id: true,
      columns: {
        orderBy: { order: 'asc' },
        select: { id: true, statuses: { select: { statusId: true } } },
      },
    },
  });
  if (boards.length === 0) return { added: 0 };
  const known = await tx.status.findMany({
    where: {
      id: {
        in: boards.flatMap((b) => b.columns.flatMap((c) => c.statuses.map((s) => s.statusId))),
      },
    },
    select: { id: true, category: true },
  });
  const categoryOf = new Map([...known, ...required].map((s) => [s.id, s.category]));

  let added = 0;
  for (const board of boards) {
    const present = new Set(board.columns.flatMap((c) => c.statuses.map((s) => s.statusId)));
    const columns: ColumnInfo[] = board.columns.map((c) => ({
      id: c.id,
      categories: c.statuses.flatMap((s) => {
        const cat = categoryOf.get(s.statusId);
        return cat ? [cat] : [];
      }),
    }));
    const links: Prisma.BoardColumnStatusCreateManyInput[] = [];
    for (const s of required) {
      if (present.has(s.id)) continue;
      const columnId = pickColumnForCategory(columns, s.category);
      if (columnId) links.push({ columnId, statusId: s.id });
    }
    if (links.length > 0) {
      await tx.boardColumnStatus.createMany({ data: links, skipDuplicates: true });
      added += links.length;
    }
  }
  return { added };
}

/**
 * Sau khi đổi quy trình (và đã thêm trạng thái mới vào cột): GỠ khỏi cột các bảng của dự án những trạng thái CŨ mà (a) không
 * thuộc quy trình nào đang dùng cho dự án và (b) không còn việc nào (kể cả thùng rác — khôi phục vẫn cần chỗ) ở trạng thái đó.
 * Không thì mọi bảng đã chuyển đổi mang theo các cột "ma" và cài đặt bảng báo trạng thái lạ. Trạng thái cuối cùng của một cột
 * KHÔNG bị gỡ (cột trống là cột hỏng; để người quản trị tự xử lý). Việc còn nằm ở trạng thái cũ thì giữ nguyên như cũ.
 * Chạy trong transaction của bên gọi; idempotent. Gọi SAU `appendMissingBoardStatuses`.
 */
export async function pruneUnusedBoardStatuses(
  tx: Prisma.TransactionClient,
  projectId: string,
  workflowIds: string[],
): Promise<{ removed: number; ghostColumns: string[] }> {
  if (workflowIds.length === 0) return { removed: 0, ghostColumns: [] };
  const removed = await removeUnusedLinks(tx, projectId, workflowIds);
  return { removed, ghostColumns: await findGhostColumns(tx, projectId, workflowIds) };
}

/**
 * Cột "ma": cột còn trạng thái nhưng TOÀN BỘ đều ngoài quy trình đang dùng (chỉ còn trạng thái cũ, thường vì còn việc nằm đó
 * hoặc là trạng thái cuối của cột nên không gỡ được). Trả "MÃ / Bảng / Cột" để báo người quản trị.
 */
async function findGhostColumns(
  tx: Prisma.TransactionClient,
  projectId: string,
  workflowIds: string[],
): Promise<string[]> {
  const columns = await tx.boardColumn.findMany({
    where: { board: { projectId, deletedAt: null } },
    orderBy: [{ boardId: 'asc' }, { order: 'asc' }],
    select: {
      name: true,
      board: { select: { name: true, project: { select: { key: true } } } },
      statuses: { select: { status: { select: { workflowId: true } } } },
    },
  });
  const live = new Set(workflowIds);
  return columns
    .filter((c) => c.statuses.length > 0 && c.statuses.every((s) => !live.has(s.status.workflowId)))
    .map((c) => `${c.board.project.key} / ${c.board.name} / ${c.name}`);
}

async function removeUnusedLinks(
  tx: Prisma.TransactionClient,
  projectId: string,
  workflowIds: string[],
): Promise<number> {
  const links = await tx.boardColumnStatus.findMany({
    where: {
      column: { board: { projectId, deletedAt: null } },
      status: { workflowId: { notIn: workflowIds } },
    },
    select: { columnId: true, statusId: true },
  });
  if (links.length === 0) return 0;
  const statusIds = [...new Set(links.map((l) => l.statusId))];
  // allow-deleted: việc ở thùng rác vẫn đang giữ trạng thái đó (khôi phục cần chỗ trên bảng) nên PHẢI được đếm
  const inUse = await tx.issue.groupBy({
    by: ['statusId'],
    where: { projectId, statusId: { in: statusIds } },
    _count: { _all: true },
  });
  const busy = new Set(inUse.map((r) => r.statusId));
  const candidates = links.filter((l) => !busy.has(l.statusId));
  if (candidates.length === 0) return 0;
  // Số trạng thái hiện có của từng cột: không gỡ cái cuối cùng.
  const columnIds = [...new Set(candidates.map((l) => l.columnId))];
  const counts = await tx.boardColumnStatus.groupBy({
    by: ['columnId'],
    where: { columnId: { in: columnIds } },
    _count: { _all: true },
  });
  const left = new Map(counts.map((c) => [c.columnId, c._count._all]));
  const drop: Array<{ columnId: string; statusId: string }> = [];
  for (const l of candidates) {
    const n = left.get(l.columnId) ?? 0;
    if (n <= 1) continue;
    left.set(l.columnId, n - 1);
    drop.push(l);
  }
  for (const d of drop)
    await tx.boardColumnStatus.deleteMany({
      where: { columnId: d.columnId, statusId: d.statusId },
    });
  return drop.length;
}
