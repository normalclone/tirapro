import { Prisma, type PrismaClient } from '@prisma/client';
import type { AffectedRuleDto, StatusCategory, WorkflowDefaultKey } from '@tirapro/types';
import {
  DEFAULT_SCHEME,
  DEFAULT_WORKFLOWS,
  LEGACY_STATUS_MAP,
  expandWorkflowTransitions,
} from '@tirapro/shared';
import { appendMissingBoardStatuses } from './board-columns-sync';
import {
  buildStatusRefMap,
  disabledRuleNotices,
  fromWorkflowsOf,
  keepStillUsedStatuses,
  rewriteRuleStatusRefs,
} from './rule-status-refs';
import {
  lockWorkspaceWorkflows,
  planMoves,
  type MoveScope,
  type PlannedMove,
} from './workflow-move';

/** Ba quy trình mặc định, tìm theo TÊN CHÍNH XÁC trong từng workspace (quy trình khác không bao giờ bị đụng tới). */
const DEFAULT_KEYS = Object.keys(DEFAULT_WORKFLOWS) as WorkflowDefaultKey[];

export interface MigrateOptions {
  dryRun: boolean;
  /** Chỉ một workspace (id hoặc slug); bỏ trống = mọi workspace chưa xoá. */
  workspace?: string;
  /** Gọi SAU commit cho mỗi quy trình vừa bị tắt (người tạo nhận thông báo). Dry-run không bao giờ gọi. */
  notify?: (n: {
    recipientId: string;
    workspaceId: string;
    ruleId: string;
    ruleName: string;
  }) => Promise<void>;
}

export interface MigrateMoveRow {
  projectKey: string;
  issueTypeName: string;
  fromStatusName: string;
  toStatusName: string;
  toWorkflowName: string;
  count: number;
  /** `legacy` = bảng ánh xạ cũ; `suggested` = cùng tên / cùng nhóm. */
  via: 'legacy' | 'suggested';
}

export interface MigrateWorkspaceResult {
  workspaceId: string;
  workspaceName: string;
  createdWorkflows: string[];
  createdSchemeRows: number;
  moves: MigrateMoveRow[];
  movedIssues: number;
  boardLinksAdded: number;
  rules: AffectedRuleDto[];
}

export interface MigrateResult {
  dryRun: boolean;
  workspaces: MigrateWorkspaceResult[];
  totals: {
    workspaces: number;
    createdWorkflows: number;
    createdSchemeRows: number;
    movedIssues: number;
    boardLinksAdded: number;
    rulesRewritten: number;
    rulesDisabled: number;
  };
}

class DryRunRollback extends Error {
  constructor(readonly result: MigrateWorkspaceResult) {
    super('dry-run rollback');
  }
}

const TX = { timeout: 600_000, maxWait: 30_000 } as const;

/**
 * Chuyển dữ liệu cũ sang quy trình theo loại việc. Mỗi workspace MỘT transaction (có khoá advisory như các thao tác quản trị
 * khác): đảm bảo 3 quy trình mặc định + dòng cấu hình cho mọi loại việc → chuyển việc đang ở trạng thái của quy trình KHÁC
 * quy trình hiệu lực (ghi đè dự án → cấu hình tổ chức) → thêm trạng thái mới vào cột bảng → sửa quy tắc automation.
 * Idempotent: chạy lại không đổi gì (dòng cấu hình đã có luôn thắng). `dryRun` chạy ĐÚNG thuật toán thật rồi rollback nên số
 * liệu khớp chạy thật. Không đổi `updatedAt` của việc; quy trình cũ của dự án được giữ nguyên (vẫn là `defaultWorkflowId`).
 * SlaPolicy / cột `wipLimit` không chứa id trạng thái nên không cần sửa.
 */
export async function migrateWorkflowSchemes(
  prisma: PrismaClient,
  opts: MigrateOptions,
): Promise<MigrateResult> {
  const workspaces = await prisma.workspace.findMany({
    where: {
      deletedAt: null,
      ...(opts.workspace ? { OR: [{ id: opts.workspace }, { slug: opts.workspace }] } : {}),
    },
    select: { id: true, name: true, ownerId: true },
    orderBy: { createdAt: 'asc' },
  });
  const results: MigrateWorkspaceResult[] = [];
  for (const ws of workspaces) {
    let result: MigrateWorkspaceResult;
    try {
      result = await prisma.$transaction(async (tx) => {
        const r = await migrateWorkspace(tx, ws);
        if (opts.dryRun) throw new DryRunRollback(r);
        return r;
      }, TX);
    } catch (e) {
      if (e instanceof DryRunRollback) result = e.result;
      else throw e;
    }
    results.push(result);
    if (!opts.dryRun && opts.notify)
      for (const n of disabledRuleNotices(ws.id, result.rules))
        await opts.notify(n).catch(() => undefined);
  }
  const sum = (f: (r: MigrateWorkspaceResult) => number) => results.reduce((a, r) => a + f(r), 0);
  return {
    dryRun: opts.dryRun,
    workspaces: results,
    totals: {
      workspaces: results.length,
      createdWorkflows: sum((r) => r.createdWorkflows.length),
      createdSchemeRows: sum((r) => r.createdSchemeRows),
      movedIssues: sum((r) => r.movedIssues),
      boardLinksAdded: sum((r) => r.boardLinksAdded),
      rulesRewritten: sum((r) => r.rules.filter((x) => x.outcome === 'rewritten').length),
      rulesDisabled: sum((r) => r.rules.filter((x) => x.outcome === 'disabled').length),
    },
  };
}

interface StatusInfo {
  id: string;
  name: string;
  category: StatusCategory;
  workflowId: string;
}

async function migrateWorkspace(
  tx: Prisma.TransactionClient,
  ws: { id: string; name: string; ownerId: string },
): Promise<MigrateWorkspaceResult> {
  await lockWorkspaceWorkflows(tx, ws.id);

  // 1. Ba quy trình mặc định (theo tên chính xác, chung của tổ chức).
  const createdWorkflows: string[] = [];
  const defaultIdByKey = new Map<WorkflowDefaultKey, string>();
  for (const key of DEFAULT_KEYS) {
    const def = DEFAULT_WORKFLOWS[key];
    const found = await tx.workflow.findFirst({
      where: { workspaceId: ws.id, projectId: null, name: def.name },
      select: { id: true },
    });
    if (found) {
      defaultIdByKey.set(key, found.id);
      continue;
    }
    const wf = await tx.workflow.create({
      data: {
        workspaceId: ws.id,
        name: def.name,
        isTemplate: false,
        statuses: {
          create: def.statuses.map((s, i) => ({
            name: s.name,
            category: s.category,
            order: i,
            isInitial: s.isInitial,
          })),
        },
      },
      select: { id: true, statuses: { select: { id: true, name: true } } },
    });
    const idByName = new Map(wf.statuses.map((s) => [s.name, s.id]));
    // Chỉ qua expandWorkflowTransitions: không bao giờ ghi '*OPEN' thô.
    const transitions = expandWorkflowTransitions(def).map((t, i) => ({
      workflowId: wf.id,
      name: t.name,
      fromStatusId: t.from === null ? null : (idByName.get(t.from) ?? null),
      toStatusId: idByName.get(t.to)!,
      order: i,
    }));
    await tx.workflowTransition.createMany({ data: transitions });
    defaultIdByKey.set(key, wf.id);
    createdWorkflows.push(def.name);
  }

  // 2. Dòng cấu hình cho mọi loại việc — dòng đã có luôn thắng.
  const types = await tx.issueType.findMany({
    where: { workspaceId: ws.id },
    select: { id: true, key: true, name: true },
  });
  const existingScheme = await tx.workspaceWorkflowScheme.findMany({
    where: { workspaceId: ws.id },
    select: { issueTypeId: true },
  });
  const have = new Set(existingScheme.map((r) => r.issueTypeId));
  const missing = types.filter((t) => !have.has(t.id));
  if (missing.length > 0)
    await tx.workspaceWorkflowScheme.createMany({
      data: missing.map((t) => ({
        workspaceId: ws.id,
        issueTypeId: t.id,
        workflowId: defaultIdByKey.get(DEFAULT_SCHEME[t.key ?? 'CUSTOM'])!,
      })),
      skipDuplicates: true,
    });

  // 3. Quy trình hiệu lực: ghi đè dự án → cấu hình tổ chức.
  const [scheme, overrides, projects] = await Promise.all([
    tx.workspaceWorkflowScheme.findMany({
      where: { workspaceId: ws.id },
      select: { issueTypeId: true, workflowId: true },
    }),
    tx.projectWorkflowOverride.findMany({
      where: { project: { workspaceId: ws.id } },
      select: { projectId: true, issueTypeId: true, workflowId: true },
    }),
    // allow-deleted: dự án đã xoá mềm/lưu trữ cũng phải khớp (khôi phục sau này không được lệch)
    tx.project.findMany({
      where: { workspaceId: ws.id },
      select: { id: true, key: true, defaultWorkflowId: true },
      orderBy: { key: 'asc' },
    }),
  ]);
  const schemeOf = new Map(scheme.map((s) => [s.issueTypeId, s.workflowId]));
  const overrideOf = new Map(
    overrides.map((o) => [`${o.projectId}:${o.issueTypeId}`, o.workflowId]),
  );
  const effective = (projectId: string, typeId: string): string | undefined =>
    overrideOf.get(`${projectId}:${typeId}`) ?? schemeOf.get(typeId);

  // Trạng thái của mọi quy trình trong workspace (tên → ánh xạ cũ; danh sách đích theo quy trình).
  const allStatuses: StatusInfo[] = await tx.status.findMany({
    where: { workflow: { workspaceId: ws.id } },
    orderBy: { order: 'asc' },
    select: { id: true, name: true, category: true, workflowId: true },
  });
  const statusById = new Map(allStatuses.map((s) => [s.id, s]));
  const workflows = await tx.workflow.findMany({
    where: { workspaceId: ws.id },
    select: { id: true, name: true },
  });
  const workflowName = new Map(workflows.map((w) => [w.id, w.name]));
  const keyOfWorkflow = new Map([...defaultIdByKey].map(([k, id]) => [id, k]));

  /** Đích theo bảng ánh xạ cũ khi quy trình đích là một trong 3 mặc định; còn lại để `planMoves` gợi ý (tên → nhóm). */
  const legacyPick = (
    _typeId: string,
    fromId: string,
    toWorkflowId: string,
  ): string | undefined => {
    const key = keyOfWorkflow.get(toWorkflowId);
    const from = statusById.get(fromId);
    if (!key || !from) return undefined;
    const targetName = LEGACY_STATUS_MAP[from.name]?.[key];
    if (!targetName) return undefined;
    return allStatuses.find((s) => s.workflowId === toWorkflowId && s.name === targetName)?.id;
  };

  // 4. Lập kế hoạch chuyển việc: mỗi (loại việc, quy trình đích) một phạm vi gồm các dự án dùng quy trình đó.
  const scopes: MoveScope[] = [];
  for (const t of types) {
    const byTarget = new Map<string, string[]>();
    for (const p of projects) {
      const target = effective(p.id, t.id);
      if (!target) continue;
      byTarget.set(target, [...(byTarget.get(target) ?? []), p.id]);
    }
    for (const [toWorkflowId, projectIds] of byTarget)
      scopes.push({ typeId: t.id, projectIds, toWorkflowId });
  }
  const moves: PlannedMove[] = [];
  const legacyHit = new Set<PlannedMove>();
  for (const scope of scopes) {
    const planned = await planMoves(tx, ws.id, [scope], (typeId, from) =>
      legacyPick(typeId, from, scope.toWorkflowId),
    );
    for (const m of planned) {
      if (!m.to) continue; // quy trình đích rỗng — không thể chuyển; bỏ qua thay vì làm hỏng cả đợt
      if (!m.suggested) legacyHit.add(m);
      moves.push(m);
    }
  }

  // 5. Chuyển việc bằng SQL thô: tăng version + lịch sử STATUS, KHÔNG đổi updatedAt.
  const resolution = await tx.resolution.findFirst({
    where: { workspaceId: ws.id, isDefault: true },
    select: { id: true },
  });
  let movedIssues = 0;
  const rows: MigrateMoveRow[] = [];
  const projectKey = new Map(projects.map((p) => [p.id, p.key]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  for (const m of moves) {
    const n = await moveRaw(tx, ws, m, resolution?.id ?? null);
    movedIssues += n;
    const to = statusById.get(m.to!.id);
    rows.push({
      projectKey: projectKey.get(m.projectId) ?? m.projectId,
      issueTypeName: typeName.get(m.typeId) ?? m.typeId,
      fromStatusName: m.from.name,
      toStatusName: m.to!.name,
      toWorkflowName: workflowName.get(to?.workflowId ?? '') ?? '',
      count: n,
      via: legacyHit.has(m) ? 'legacy' : 'suggested',
    });
  }

  // 6. Cột bảng: thêm trạng thái mới của quy trình hiệu lực cạnh trạng thái cũ (không gỡ gì).
  let boardLinksAdded = 0;
  for (const p of projects) {
    const used = [...new Set(types.flatMap((t) => effective(p.id, t.id) ?? []))];
    boardLinksAdded += (await appendMissingBoardStatuses(tx, p.id, used)).added;
  }

  // 7. Sửa quy tắc automation: cùng hàm với các API đổi quy trình.
  const pairs = scopes.map((s) => ({
    typeId: s.typeId,
    toWorkflowId: s.toWorkflowId,
    fromWorkflowIds: fromWorkflowsOf(
      s.typeId,
      projects.flatMap((p) => (p.defaultWorkflowId ? [p.defaultWorkflowId] : [])),
      moves,
    ),
  }));
  const base = await buildStatusRefMap(tx, pairs, legacyPick);
  const map = await keepStillUsedStatuses(tx, base, []);
  const { affectedRules } = await rewriteRuleStatusRefs(tx, ws.id, map, { dryRun: false });

  return {
    workspaceId: ws.id,
    workspaceName: ws.name,
    createdWorkflows,
    createdSchemeRows: missing.length,
    moves: rows,
    movedIssues,
    boardLinksAdded,
    rules: affectedRules,
  };
}

async function moveRaw(
  tx: Prisma.TransactionClient,
  ws: { id: string; ownerId: string },
  m: PlannedMove,
  defaultResolutionId: string | null,
): Promise<number> {
  const to = m.to!;
  const enteringDone = to.category === 'DONE' && m.from.category !== 'DONE';
  const leavingDone = to.category !== 'DONE' && m.from.category === 'DONE';
  const resolvedAt = enteringDone
    ? Prisma.sql`COALESCE("resolvedAt", now())`
    : leavingDone
      ? Prisma.sql`NULL`
      : Prisma.sql`"resolvedAt"`;
  const resolutionId = enteringDone
    ? Prisma.sql`COALESCE("resolutionId", ${defaultResolutionId}::text)`
    : leavingDone
      ? Prisma.sql`NULL`
      : Prisma.sql`"resolutionId"`;
  // allow-deleted: cả việc trong thùng rác phải rời trạng thái của quy trình bị bỏ
  return tx.$executeRaw`
    WITH moved AS (
      UPDATE "Issue"
         SET "statusId" = ${to.id},
             "version" = "version" + 1,
             "resolvedAt" = ${resolvedAt},
             "resolutionId" = ${resolutionId}
       WHERE "workspaceId" = ${ws.id}
         AND "projectId" = ${m.projectId}
         AND "typeId" = ${m.typeId}
         AND "statusId" = ${m.from.id}
      RETURNING "id", "projectId", "sprintId"
    )
    INSERT INTO "IssueHistory"
      ("id", "issueId", "projectId", "sprintId", "field", "oldValue", "newValue",
       "oldCategory", "newCategory", "actorId", "occurredAt", "createdAt")
    SELECT gen_random_uuid()::text, "id", "projectId", "sprintId", 'STATUS'::"HistoryField",
           ${m.from.name}, ${to.name},
           ${m.from.category}::"StatusCategory", ${to.category}::"StatusCategory",
           ${ws.ownerId}, now(), now()
      FROM moved`;
}
