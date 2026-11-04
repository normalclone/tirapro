import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { DOMAIN_EVENTS, type AffectedRuleDto, type StatusCategory } from '@tirapro/types';
import { remapRuleStatusIds, suggestTargetStatus, type StatusRefMap } from '@tirapro/shared';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PlannedMove } from './workflow-move';

/**
 * Sửa tham chiếu trạng thái trong quy tắc automation của MỘT workspace theo `fromToMap` (id cũ → id mới, xem
 * `remapRuleStatusIds`). MỘT hàm dùng chung cho: PUT workflow-schemes, PUT/DELETE ghi đè dự án, xoá trạng thái có thay thế, và
 * script migrate. Quy tắc không ánh xạ được (trạng thái cũ không còn thay thế) bị TẮT — bên gọi báo cho người tạo SAU commit
 * (`disabledRuleNotices`). `dryRun`: chỉ liệt kê `affectedRules`, không ghi gì.
 * Chạy trong transaction của bên gọi; idempotent (id mới không nằm trong `fromToMap`).
 */
export async function rewriteRuleStatusRefs(
  db: Prisma.TransactionClient,
  workspaceId: string,
  fromToMap: StatusRefMap,
  opts: {
    dryRun: boolean;
    /**
     * Phạm vi của quy tắc: trả về các quy trình mà việc thuộc phạm vi quy tắc THỰC SỰ dùng (null = không giới hạn). Đích ở quy
     * trình khác bị bỏ để quy tắc "Review code" không rộng ra thành mọi trạng thái của Bug/Epic nếu phạm vi quy tắc không có
     * các loại đó. Không còn đích nào thì giữ danh sách đầy đủ (không tắt quy tắc chỉ vì phạm vi hẹp).
     */
    scopeOf?: (rule: {
      projectId: string | null;
      conditions: unknown;
    }) => ReadonlySet<string> | null;
    /**
     * Đổi quy trình của MỘT dự án: chỉ sửa/tắt quy tắc CỦA dự án đó. Quy tắc áp toàn tổ chức (`projectId` null) nhắc tới trạng thái
     * bị đổi chỉ được BÁO (`needsReview`: cần Quản trị chung xem lại), không ghi gì; quy tắc của dự án khác không được đọc.
     */
    projectScope?: string;
  },
): Promise<{ affectedRules: AffectedRuleDto[] }> {
  const affectedRules: AffectedRuleDto[] = [];
  if (fromToMap.size === 0) return { affectedRules };
  const rules = await db.automationRule.findMany({
    where: {
      workspaceId,
      ...(opts.projectScope ? { OR: [{ projectId: opts.projectScope }, { projectId: null }] } : {}),
    },
    select: {
      id: true,
      name: true,
      projectId: true,
      createdById: true,
      enabled: true,
      triggerConfig: true,
      conditions: true,
      actions: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (rules.length === 0) return { affectedRules };
  // Tên + quy trình của mọi trạng thái liên quan (id cũ và đích) để lọc theo phạm vi và in "trước → sau".
  const involved = [...new Set([...fromToMap.keys(), ...[...fromToMap.values()].flat()])];
  const info = new Map(
    (
      await db.status.findMany({
        where: { id: { in: involved } },
        select: { id: true, name: true, workflowId: true },
      })
    ).map((x) => [x.id, x]),
  );
  const nameOf = (id: string): string => info.get(id)?.name ?? id;
  for (const r of rules) {
    const allowed = opts.scopeOf?.(r) ?? null;
    const map: StatusRefMap = allowed
      ? new Map(
          [...fromToMap].map(([from, targets]) => {
            const kept = targets.filter(
              (t) => t === from || allowed.has(info.get(t)?.workflowId ?? ''),
            );
            return [from, kept.length > 0 ? kept : targets] as const;
          }),
        )
      : fromToMap;
    const out = remapRuleStatusIds(r, map);
    if (!out.touched) continue;
    const base = {
      ruleId: r.id,
      name: r.name,
      projectId: r.projectId,
      createdById: r.createdById,
      wasEnabled: r.enabled,
      statusRefs: out.touchedIds.map((fromId) => {
        const toIds = out.unmappable.includes(fromId) ? [] : [...(map.get(fromId) ?? [])];
        return { fromId, fromName: nameOf(fromId), toIds, toNames: toIds.map(nameOf) };
      }),
    };
    if (opts.projectScope && r.projectId === null) {
      // Quy tắc toàn tổ chức: chỉ báo, không sửa/tắt từ một thay đổi của riêng dự án.
      affectedRules.push({ ...base, outcome: 'needsReview' });
      continue;
    }
    if (out.unmappable.length > 0) {
      affectedRules.push({ ...base, outcome: 'disabled', unmappableStatusIds: out.unmappable });
      if (!opts.dryRun && r.enabled)
        await db.automationRule.update({ where: { id: r.id }, data: { enabled: false } });
      continue;
    }
    const changed =
      JSON.stringify([out.triggerConfig, out.conditions, out.actions]) !==
      JSON.stringify([r.triggerConfig, r.conditions, r.actions]);
    if (!changed) continue;
    affectedRules.push({ ...base, outcome: 'rewritten' });
    if (!opts.dryRun)
      await db.automationRule.update({
        where: { id: r.id },
        data: {
          triggerConfig: out.triggerConfig as Prisma.InputJsonValue,
          conditions: out.conditions as Prisma.InputJsonValue,
          actions: out.actions as Prisma.InputJsonValue,
        },
      });
  }
  return { affectedRules };
}

/** Loại việc mà quy tắc giới hạn bằng điều kiện `typeId` (eq/in); null = không giới hạn loại. */
export function ruleTypeScope(conditions: unknown): string[] | null {
  if (!Array.isArray(conditions)) return null;
  for (const c of conditions as Array<Record<string, unknown>>) {
    if (c?.field !== 'typeId') continue;
    if (c.op === 'eq' && typeof c.value === 'string') return [c.value];
    if (c.op === 'in' && Array.isArray(c.value))
      return c.value.filter((x): x is string => typeof x === 'string');
  }
  return null;
}

/**
 * `scopeOf` cho các endpoint đổi quy trình: quy tắc giới hạn bằng điều kiện `typeId` thì chỉ nhận trạng thái ở quy trình đích của
 * các loại đó; quy tắc không giới hạn loại nhận đích của mọi loại đang đổi. Không trúng loại nào → null (không giới hạn).
 */
export function scopeFromPairs(
  pairs: Array<{ typeId: string; toWorkflowId: string }>,
): (rule: { conditions: unknown }) => ReadonlySet<string> | null {
  return (rule) => {
    const types = ruleTypeScope(rule.conditions);
    const hit = pairs.filter((p) => !types || types.includes(p.typeId));
    return hit.length > 0 ? new Set(hit.map((p) => p.toWorkflowId)) : null;
  };
}

/** Người nhận + nội dung thông báo "Quy tắc … đã tắt vì trạng thái không còn" cho các quy tắc vừa bị TẮT (đang bật trước đó). */
export function disabledRuleNotices(
  workspaceId: string,
  affected: AffectedRuleDto[],
): Array<{ recipientId: string; workspaceId: string; ruleId: string; ruleName: string }> {
  return affected
    .filter((a) => a.outcome === 'disabled' && a.wasEnabled)
    .map((a) => ({ recipientId: a.createdById, workspaceId, ruleId: a.ruleId, ruleName: a.name }));
}

/** Sự kiện bỏ cache quy tắc (engine đọc bản mới) — chỉ khi thật sự có quy tắc bị sửa/tắt. */
const RULES_CHANGED_EVENT = DOMAIN_EVENTS.AUTOMATION_RULES_CHANGED;

interface StatusLite {
  id: string;
  name: string;
  category: StatusCategory;
  order?: number;
  isInitial?: boolean;
}

/**
 * Ánh xạ trạng thái cho quy tắc khi các loại việc đổi quy trình: mọi trạng thái của các quy trình CŨ → trạng thái đích trong
 * quy trình mới (`pick` = `statusMap` người dùng chọn, không có thì gợi ý cùng tên/cùng nhóm). Một id cũ có thể sang nhiều đích
 * (mỗi loại việc một quy trình đích).
 */
export async function buildStatusRefMap(
  db: Prisma.TransactionClient,
  pairs: Array<{ typeId: string; fromWorkflowIds: string[]; toWorkflowId: string }>,
  pick: (typeId: string, fromStatusId: string, toWorkflowId: string) => string | undefined,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const targetsOf = new Map<string, StatusLite[]>();
  for (const p of pairs) {
    const fromIds = [...new Set(p.fromWorkflowIds)].filter((w) => w !== p.toWorkflowId);
    if (fromIds.length === 0) continue;
    if (!targetsOf.has(p.toWorkflowId))
      targetsOf.set(
        p.toWorkflowId,
        await db.status.findMany({
          where: { workflowId: p.toWorkflowId },
          orderBy: { order: 'asc' },
          select: { id: true, name: true, category: true, order: true, isInitial: true },
        }),
      );
    const targets = targetsOf.get(p.toWorkflowId)!;
    const froms = await db.status.findMany({
      where: { workflowId: { in: fromIds } },
      select: { id: true, name: true, category: true },
    });
    for (const f of froms) {
      const wanted = pick(p.typeId, f.id, p.toWorkflowId);
      const chosen = targets.find((t) => t.id === wanted) ?? suggestTargetStatus(f, targets);
      if (!chosen) continue;
      const cur = map.get(f.id) ?? [];
      if (!cur.includes(chosen.id)) map.set(f.id, [...cur, chosen.id]);
    }
  }
  return map;
}

/**
 * Trạng thái cũ còn việc (sau khi chuyển, hoặc sau khi chuyển theo kế hoạch `pending` nếu chỉ xem trước) thì giữ id cũ làm đích
 * thứ hai: quy tắc vẫn khớp những việc ở lại quy trình cũ (dự án có ghi đè, loại việc khác dùng chung quy trình cũ…).
 */
export async function keepStillUsedStatuses(
  db: Prisma.TransactionClient,
  map: Map<string, string[]>,
  pending: PlannedMove[],
): Promise<Map<string, string[]>> {
  if (map.size === 0) return map;
  // allow-deleted: việc trong thùng rác vẫn giữ trạng thái (khôi phục sau này), nên cũng tính là còn dùng
  const used = await db.issue.groupBy({
    by: ['statusId'],
    where: { statusId: { in: [...map.keys()] } },
    _count: { _all: true },
  });
  const planned = new Map<string, number>();
  for (const m of pending) planned.set(m.from.id, (planned.get(m.from.id) ?? 0) + m.count);
  const out = new Map(map);
  for (const u of used) {
    if (u._count._all - (planned.get(u.statusId) ?? 0) <= 0) continue;
    out.set(u.statusId, [...new Set([...(out.get(u.statusId) ?? []), u.statusId])]);
  }
  return out;
}

const logger = new Logger('RuleStatusRefs');

/**
 * SAU commit: bỏ cache quy tắc và báo người tạo các quy tắc vừa bị TẮT ("Quy tắc … đã tắt vì trạng thái không còn").
 * Thông báo đi qua `NotificationsService.publish` (chốt trung tâm); lỗi chỉ ghi log — dữ liệu đã commit.
 */
export async function publishRuleChanges(
  deps: { events?: EventEmitter2; notifications?: NotificationsService },
  workspaceId: string,
  actorId: string,
  affected: AffectedRuleDto[],
): Promise<void> {
  if (affected.length === 0) return;
  deps.events?.emit(RULES_CHANGED_EVENT, { workspaceId });
  for (const n of disabledRuleNotices(workspaceId, affected)) {
    try {
      await deps.notifications?.publish(
        {
          recipientId: n.recipientId,
          workspaceId,
          type: 'ISSUE_UPDATED',
          actorId,
          payload: { automationRuleDisabled: n.ruleName },
        },
        { force: true },
      );
    } catch (e) {
      logger.warn(`Không báo được quy tắc "${n.ruleName}" đã tắt: ${(e as Error).message}`);
    }
  }
}

/**
 * Bước quy tắc của một thay đổi quy trình: dựng ánh xạ, giữ id cũ nếu còn việc, rồi sửa/liệt kê quy tắc. Gọi SAU khi việc đã
 * chuyển (chạy thật) hoặc cùng `pending` = kế hoạch chuyển (xem trước).
 */
export async function ruleStepForMoves(
  db: Prisma.TransactionClient,
  workspaceId: string,
  pairs: Array<{ typeId: string; fromWorkflowIds: string[]; toWorkflowId: string }>,
  pick: (typeId: string, fromStatusId: string, toWorkflowId: string) => string | undefined,
  pending: PlannedMove[],
  dryRun: boolean,
  projectScope?: string,
): Promise<AffectedRuleDto[]> {
  const base = await buildStatusRefMap(db, pairs, pick);
  const map = await keepStillUsedStatuses(db, base, dryRun ? pending : []);
  return (
    await rewriteRuleStatusRefs(db, workspaceId, map, {
      dryRun,
      scopeOf: scopeFromPairs(pairs),
      projectScope,
    })
  ).affectedRules;
}

/** Các quy trình cũ cần ánh xạ cho quy tắc: quy trình trước đây của loại + quy trình của trạng thái việc đang được chuyển. */
export function fromWorkflowsOf(
  typeId: string,
  previous: string[],
  moves: PlannedMove[],
): string[] {
  const fromMoves = moves
    .filter((m) => m.typeId === typeId)
    .flatMap((m) => (m.from.workflowId ? [m.from.workflowId] : []));
  return [...new Set([...previous, ...fromMoves])];
}
