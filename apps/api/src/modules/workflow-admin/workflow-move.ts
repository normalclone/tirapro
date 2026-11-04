import type { Prisma } from '@prisma/client';
import type { ErrorDetail, WorkflowMoveRowDto } from '@tirapro/types';
import { suggestTargetStatus } from '@tirapro/shared';
import {
  BusinessRuleException,
  StatusMappingRequiredException,
} from '../../common/exceptions/app.exception';
import type { StatusRef } from './issue-status-move';

/** Việc của `typeId` trong `projectIds` phải thuộc quy trình `toWorkflowId` (việc đang ở quy trình khác sẽ bị chuyển). */
export interface MoveScope {
  typeId: string;
  projectIds: string[];
  toWorkflowId: string;
}

export interface PlannedMove {
  projectId: string;
  typeId: string;
  from: StatusRef;
  to: StatusRef | null;
  count: number;
  suggested: boolean;
}

type TargetStatus = StatusRef & { order: number; isInitial: boolean };

/**
 * Lập kế hoạch chuyển trạng thái: gom việc (theo dự án, loại, trạng thái hiện tại) đang ở quy trình KHÁC quy trình đích, rồi
 * tìm trạng thái đích cho từng nhóm bằng `pick(typeId, trạng thái cũ)` (= `statusMap`). Nhóm chưa có đích được gợi ý
 * (`suggestTargetStatus`) và đánh dấu `suggested` — xem trước (dryRun) hiện gợi ý, chạy thật thì 422 STATUS_MAPPING_REQUIRED.
 * Đích do người dùng chọn mà không thuộc quy trình đích → 422. Không có việc nào phải chuyển thì không cần statusMap.
 */
export async function planMoves(
  db: Prisma.TransactionClient,
  workspaceId: string,
  scopes: MoveScope[],
  pick: (typeId: string, fromStatusId: string) => string | undefined,
): Promise<PlannedMove[]> {
  const moves: PlannedMove[] = [];
  const targetsCache = new Map<string, TargetStatus[]>();
  const targetsOf = async (workflowId: string): Promise<TargetStatus[]> => {
    let t = targetsCache.get(workflowId);
    if (!t) {
      t = await db.status.findMany({
        where: { workflowId },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, category: true, order: true, isInitial: true },
      });
      targetsCache.set(workflowId, t);
    }
    return t;
  };
  for (const scope of scopes) {
    if (scope.projectIds.length === 0) continue;
    // allow-deleted: việc trong thùng rác cũng phải rời trạng thái của quy trình bị bỏ (khôi phục sau này không được lệch)
    const groups = await db.issue.groupBy({
      by: ['projectId', 'statusId'],
      where: {
        workspaceId,
        typeId: scope.typeId,
        projectId: { in: scope.projectIds },
        status: { workflowId: { not: scope.toWorkflowId } },
      },
      _count: { _all: true },
    });
    if (groups.length === 0) continue;
    const fromStatuses = await db.status.findMany({
      where: { id: { in: [...new Set(groups.map((g) => g.statusId))] } },
      select: { id: true, name: true, category: true, workflowId: true },
    });
    const fromById = new Map(fromStatuses.map((s) => [s.id, s]));
    const targets = await targetsOf(scope.toWorkflowId);
    for (const g of groups) {
      const from = fromById.get(g.statusId);
      if (!from) continue;
      const wanted = pick(scope.typeId, g.statusId);
      const chosen = wanted ? targets.find((t) => t.id === wanted) : undefined;
      // Đích trong `statusMap` không thuộc quy trình đích (vd. khoá phẳng dùng chung cho nhiều loại sang quy trình khác nhau)
      // thì coi như chưa chọn cho loại này; id không tồn tại ở đâu cả đã bị `assertMapInWorkspace` chặn từ trước.
      const suggestion = chosen ? null : suggestTargetStatus(from, targets);
      moves.push({
        projectId: g.projectId,
        typeId: scope.typeId,
        from,
        to: chosen ?? suggestion,
        count: g._count._all,
        suggested: !chosen,
      });
    }
  }
  return moves;
}

/** Bảng "việc sẽ chuyển" cho phản hồi/xem trước. */
export function toMoveRows(
  moves: PlannedMove[],
  names: { projects: Map<string, string>; types: Map<string, string> },
): WorkflowMoveRowDto[] {
  return moves.map((m) => ({
    projectId: m.projectId,
    projectKey: names.projects.get(m.projectId) ?? m.projectId,
    issueTypeId: m.typeId,
    issueTypeName: names.types.get(m.typeId) ?? m.typeId,
    fromStatusId: m.from.id,
    fromStatusName: m.from.name,
    toStatusId: m.to?.id ?? null,
    toStatusName: m.to?.name ?? null,
    count: m.count,
    suggested: m.suggested,
  }));
}

/**
 * Khoá advisory theo workspace TRONG transaction (tự nhả khi commit/rollback): hai thay đổi quy trình đồng thời trong cùng một
 * workspace (PUT scheme, ghi đè dự án, xoá trạng thái có thay thế, script migrate) xếp hàng thay vì đọc kế hoạch cũ rồi chuyển
 * việc chồng lên nhau. KHÔNG chặn đọc/ghi việc thường.
 */
export async function lockWorkspaceWorkflows(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workflow-scheme:${workspaceId}`}))`;
}

/** Chạy thật mà còn nhóm chưa có đích do người dùng chọn → 422 STATUS_MAPPING_REQUIRED, mỗi trạng thái cũ một dòng. */
export function assertAllMapped(moves: PlannedMove[], typeNames: Map<string, string>): void {
  const missing = new Map<string, ErrorDetail>();
  for (const m of moves) {
    if (!m.suggested && m.to) continue;
    const key = `${m.typeId}:${m.from.id}`;
    if (missing.has(key)) continue;
    missing.set(key, {
      field: `statusMap.${m.from.id}`,
      code: 'STATUS_MAPPING_REQUIRED',
      message: `Hãy chọn trạng thái mới cho việc loại "${typeNames.get(m.typeId) ?? m.typeId}" đang ở "${m.from.name}"`,
      ...(m.to ? { suggestedStatusId: m.to.id } : {}),
    });
  }
  if (missing.size > 0)
    throw new StatusMappingRequiredException(
      'Quy trình mới khác quy trình hiện tại — hãy chọn trạng thái mới cho các việc đang có',
      [...missing.values()],
    );
}

/** Mọi id trong `statusMap` (cả khoá lẫn đích) phải là trạng thái của tổ chức này — id sai/đã xoá/của tổ chức khác → 422. */
export async function assertMapInWorkspace(
  db: Prisma.TransactionClient,
  workspaceId: string,
  statusMaps: Array<Record<string, string> | undefined>,
): Promise<void> {
  const ids = new Set<string>();
  for (const m of statusMaps) for (const [k, v] of Object.entries(m ?? {})) ids.add(k).add(v);
  if (ids.size === 0) return;
  const found = await db.status.count({
    where: { id: { in: [...ids] }, workflow: { workspaceId } },
  });
  if (found !== ids.size)
    throw new BusinessRuleException(
      'Bảng chuyển trạng thái có trạng thái không tồn tại — hãy tải lại trang rồi chọn lại',
    );
}
