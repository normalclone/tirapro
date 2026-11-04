import type { Prisma } from '@prisma/client';
import type { NameRefDto } from '@tirapro/types';
import type { PlannedMove } from './workflow-move';

const lc = (x: string): string => x.trim().toLowerCase();
const mentions = (text: string, name: string): boolean => {
  const esc = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
};

/**
 * Chỉ BÁO (không sửa) các đối tượng lọc theo TÊN trạng thái trong JQL — bộ lọc đã lưu, bộ lọc bảng, widget, điều kiện JQL của
 * quy tắc, KR — mà tên đó sẽ không còn ở quy trình nào đang dùng sau migrate (nên câu lọc không còn khớp việc nào).
 */
export async function findNameRefs(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  moves: ReadonlyArray<Pick<PlannedMove, 'from'>>,
  liveWorkflowIds: ReadonlySet<string>,
): Promise<NameRefDto[]> {
  if (moves.length === 0) return [];
  const live = new Set(
    (
      await tx.status.findMany({
        where: { workflowId: { in: [...liveWorkflowIds] } },
        select: { name: true },
      })
    ).map((x) => lc(x.name)),
  );
  const gone = [...new Set(moves.map((m) => m.from.name))].filter((n) => !live.has(lc(n)));
  if (gone.length === 0) return [];
  const out: NameRefDto[] = [];
  const check = (kind: NameRefDto['kind'], id: string, label: string, jql: unknown) => {
    if (typeof jql !== 'string' || !jql) return;
    const names = gone.filter((n) => mentions(jql, n));
    if (names.length > 0) out.push({ kind, id, label, names });
  };
  for (const f of await tx.savedFilter.findMany({
    where: { workspaceId, deletedAt: null },
    select: { id: true, name: true, jql: true },
  }))
    check('savedFilter', f.id, f.name, f.jql);
  for (const b of await tx.board.findMany({
    where: { project: { workspaceId }, deletedAt: null, filterJql: { not: null } },
    select: { id: true, name: true, filterJql: true, project: { select: { key: true } } },
  }))
    check('boardFilter', b.id, `${b.project.key} / ${b.name}`, b.filterJql);
  for (const w of await tx.widget.findMany({
    where: { dashboard: { workspaceId, deletedAt: null } },
    select: { id: true, title: true, config: true, dashboard: { select: { name: true } } },
  }))
    check(
      'widget',
      w.id,
      `${w.dashboard.name} / ${w.title}`,
      (w.config as { jql?: unknown } | null)?.jql,
    );
  for (const r of await tx.automationRule.findMany({
    where: { workspaceId },
    select: { id: true, name: true, conditions: true },
  }))
    for (const c of Array.isArray(r.conditions) ? (r.conditions as Array<{ jql?: unknown }>) : [])
      check('rule', r.id, r.name, c?.jql);
  for (const k of await tx.keyResult.findMany({
    where: { objective: { workspaceId } },
    select: { id: true, name: true, sourceConfig: true },
  }))
    check('keyResult', k.id, k.name, (k.sourceConfig as { jql?: unknown } | null)?.jql);
  return out;
}

/**
 * Các quy trình còn "sống" SAU thay đổi (để biết tên trạng thái nào thật sự biến mất): quy trình đích, quy trình của các loại việc
 * không đổi, và mọi ghi đè của dự án. Xấp xỉ có chủ đích (chỉ phục vụ báo trước, không chặn thao tác).
 */
export async function liveWorkflowIdsAfter(
  db: Prisma.TransactionClient,
  workspaceId: string,
  targetWorkflowIds: string[],
  changedTypeIds: string[],
): Promise<Set<string>> {
  const [scheme, overrides] = await Promise.all([
    db.workspaceWorkflowScheme.findMany({
      where: { workspaceId, issueTypeId: { notIn: changedTypeIds } },
      select: { workflowId: true },
    }),
    db.projectWorkflowOverride.findMany({
      where: { project: { workspaceId } },
      select: { workflowId: true },
    }),
  ]);
  return new Set([
    ...targetWorkflowIds,
    ...scheme.map((s) => s.workflowId),
    ...overrides.map((o) => o.workflowId),
  ]);
}
