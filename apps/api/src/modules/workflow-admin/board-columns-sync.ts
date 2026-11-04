import type { Prisma } from '@prisma/client';
import type { StatusCategory } from '@tirapro/types';
import { suggestTargetStatus } from '@tirapro/shared';

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

/** Một trạng thái cũ (đang nằm trong cột nhưng không thuộc quy trình đang dùng) mà ta cần biết đích thay thế của nó. */
export interface LegacyStatusRef {
  id: string;
  name: string;
  category: StatusCategory;
}

interface FlowStatus {
  id: string;
  name: string;
  category: StatusCategory;
  order: number;
  isInitial: boolean;
  workflowId: string;
}

/**
 * Trạng thái MỚI → các trạng thái CŨ (đang nằm trong cột) mà nó thay thế: với mỗi quy trình đang dùng và mỗi trạng thái cũ, đích
 * là `pick(cũ, quy trình)` (bảng ánh xạ của script migrate) hoặc gợi ý chung (cùng tên → cùng nhóm → khởi tạo). Dùng để đặt
 * trạng thái mới vào ĐÚNG CỘT của trạng thái cũ tương ứng ("Chờ test" → Ready for Retest, "Review code" → In Review) thay vì dồn
 * hết về ba cột To Do / In Progress / Done.
 */
export function replacementSources(
  legacy: readonly LegacyStatusRef[],
  inUse: readonly FlowStatus[],
  pick?: (legacy: LegacyStatusRef, toWorkflowId: string) => string | undefined,
): Map<string, Set<string>> {
  const byFlow = new Map<string, FlowStatus[]>();
  for (const s of inUse) byFlow.set(s.workflowId, [...(byFlow.get(s.workflowId) ?? []), s]);
  const out = new Map<string, Set<string>>();
  for (const [workflowId, statuses] of byFlow)
    for (const l of legacy) {
      const targetId = pick?.(l, workflowId) ?? suggestTargetStatus(l, statuses)?.id;
      if (!targetId) continue;
      const set = out.get(targetId) ?? new Set<string>();
      set.add(l.id);
      out.set(targetId, set);
    }
  return out;
}

/**
 * Sau khi đổi quy trình của một dự án (cấu hình tổ chức / ghi đè) hoặc khi tạo dự án: thêm vào MỖI bảng của dự án các trạng
 * thái của quy trình đang dùng mà chưa nằm trong cột nào — để bảng vẫn lưu được (`setColumns` bắt buộc phủ mọi trạng thái) và
 * không thẻ nào biến mất. Mỗi trạng thái mới vào CỘT đang giữ trạng thái cũ mà nó thay thế (`replacementSources`; cột đầu theo
 * thứ tự cột nếu có nhiều), chỉ khi không có cột nguồn mới rơi về cột cùng nhóm. Không bao giờ gỡ trạng thái cũ khỏi cột (việc đó
 * của `pruneUnusedBoardStatuses`). Chạy trong transaction của bên gọi; idempotent.
 */
export async function appendMissingBoardStatuses(
  tx: Prisma.TransactionClient,
  projectId: string,
  workflowIds: string[],
  opts?: { pick?: (legacy: LegacyStatusRef, toWorkflowId: string) => string | undefined },
): Promise<{ added: number }> {
  if (workflowIds.length === 0) return { added: 0 };
  const required: FlowStatus[] = await tx.status.findMany({
    where: { workflowId: { in: workflowIds } },
    orderBy: [{ workflowId: 'asc' }, { order: 'asc' }],
    select: {
      id: true,
      name: true,
      category: true,
      order: true,
      isInitial: true,
      workflowId: true,
    },
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
    select: { id: true, name: true, category: true, workflowId: true },
  });
  const categoryOf = new Map([...known, ...required].map((s) => [s.id, s.category]));
  const inUse = new Set(workflowIds);
  const sources = replacementSources(
    known.filter((k) => !inUse.has(k.workflowId)),
    required,
    opts?.pick,
  );

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
      const from = sources.get(s.id);
      // Cột nguồn: cột đầu tiên (theo thứ tự cột) đang giữ một trạng thái cũ mà trạng thái này thay thế.
      const source = from
        ? board.columns.find((c) => c.statuses.some((x) => from.has(x.statusId)))?.id
        : undefined;
      const columnId = source ?? pickColumnForCategory(columns, s.category);
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
): Promise<{ removed: number; deletedColumns: string[]; ghostColumns: string[] }> {
  if (workflowIds.length === 0) return { removed: 0, deletedColumns: [], ghostColumns: [] };
  const removed = await removeUnusedLinks(tx, projectId, workflowIds);
  return { removed, ...(await deleteGhostColumns(tx, projectId, workflowIds)) };
}

/**
 * Cột "ma": cột có trạng thái nhưng TOÀN BỘ đều ngoài quy trình đang dùng của dự án. Cột như vậy mà không còn việc nào
 * (kể cả thùng rác) ở các trạng thái đó thì không bao giờ hiện thẻ nữa → XOÁ, rồi đánh số lại vị trí các cột còn lại. Không
 * bao giờ xoá cột có trạng thái đang dùng hoặc còn việc; không để bảng hết cột (xoá hết thì giữ lại cột đầu và báo). Trả
 * `deletedColumns` (đã xoá) và `ghostColumns` (còn lại, cần người dọn) dạng "MÃ / Bảng / Cột".
 */
async function deleteGhostColumns(
  tx: Prisma.TransactionClient,
  projectId: string,
  workflowIds: string[],
): Promise<{ deletedColumns: string[]; ghostColumns: string[] }> {
  const columns = await tx.boardColumn.findMany({
    where: { board: { projectId, deletedAt: null } },
    orderBy: [{ boardId: 'asc' }, { order: 'asc' }],
    select: {
      id: true,
      boardId: true,
      name: true,
      board: { select: { name: true, project: { select: { key: true } } } },
      statuses: { select: { statusId: true, status: { select: { workflowId: true } } } },
    },
  });
  const live = new Set(workflowIds);
  const label = (c: (typeof columns)[number]) =>
    `${c.board.project.key} / ${c.board.name} / ${c.name}`;
  const ghosts = columns.filter(
    (c) => c.statuses.length > 0 && c.statuses.every((s) => !live.has(s.status.workflowId)),
  );
  if (ghosts.length === 0) return { deletedColumns: [], ghostColumns: [] };
  const ghostStatusIds = [...new Set(ghosts.flatMap((c) => c.statuses.map((s) => s.statusId)))];
  // allow-deleted: việc ở thùng rác vẫn giữ trạng thái đó (khôi phục cần chỗ trên bảng) nên PHẢI được đếm
  const counts = await tx.issue.groupBy({
    by: ['statusId'],
    where: { projectId, statusId: { in: ghostStatusIds } },
    _count: { _all: true },
  });
  const busy = new Set(counts.map((r) => r.statusId));
  const empty = ghosts.filter((c) => c.statuses.every((s) => !busy.has(s.statusId)));
  // Mỗi bảng phải còn ít nhất một cột: nếu mọi cột của bảng đều bị xoá thì giữ lại cột đầu.
  const total = new Map<string, number>();
  for (const c of columns) total.set(c.boardId, (total.get(c.boardId) ?? 0) + 1);
  const perBoard = new Map<string, typeof empty>();
  for (const c of empty) perBoard.set(c.boardId, [...(perBoard.get(c.boardId) ?? []), c]);
  const toDelete: typeof empty = [];
  for (const [boardId, list] of perBoard)
    toDelete.push(...(list.length === total.get(boardId) ? list.slice(1) : list));
  if (toDelete.length > 0) {
    const ids = toDelete.map((c) => c.id);
    await tx.boardColumn.deleteMany({ where: { id: { in: ids } } }); // BoardColumnStatus xoá theo (cascade)
    // Đánh số lại vị trí cột của các bảng đã bị xoá bớt cột: 0..n-1 theo thứ tự cũ.
    const gone = new Set(ids);
    for (const boardId of new Set(toDelete.map((c) => c.boardId))) {
      const left = columns.filter((c) => c.boardId === boardId && !gone.has(c.id));
      for (const [order, c] of left.entries())
        await tx.boardColumn.update({ where: { id: c.id }, data: { order } });
    }
  }
  const deleted = new Set(toDelete.map((c) => c.id));
  return {
    deletedColumns: toDelete.map(label),
    ghostColumns: ghosts.filter((c) => !deleted.has(c.id)).map(label),
  };
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
