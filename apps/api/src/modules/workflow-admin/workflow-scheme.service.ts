import { Injectable, Optional } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type {
  AffectedRuleDto,
  NameRefDto,
  ProjectWorkflowSchemeDto,
  WorkflowChangeDto,
  WorkspaceWorkflowSchemeDto,
} from '@tirapro/types';
import type { SetProjectOverrideInput, SetWorkspaceSchemeInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertProjectIdWritable } from '../../common/project-writable';
import { findNameRefs, liveWorkflowIdsAfter } from './name-refs';
import { appendMissingBoardStatuses, pruneUnusedBoardStatuses } from './board-columns-sync';
import type { NotificationsService } from '../notifications/notifications.service';
import { fromWorkflowsOf, publishRuleChanges, ruleStepForMoves } from './rule-status-refs';
import { systemActorId } from './system-actor';
import { moveIssuesToStatus } from './issue-status-move';
import {
  assertAllMapped,
  assertMapInWorkspace,
  lockWorkspaceWorkflows,
  planMoves,
  toMoveRows,
  type MoveScope,
  type PlannedMove,
} from './workflow-move';
import { WorkflowResolver } from './workflow-resolver.service';
import { ProjectAccessService } from '../rbac/project-access.service';

/** Đổi quy trình có thể chuyển hàng nghìn việc: nới timeout mặc định 5s của interactive transaction. */
const TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 } as const;

const WORKFLOW_NOT_SELECTABLE =
  'Chỉ chọn được quy trình chung của tổ chức (không phải mẫu, không phải quy trình riêng của dự án khác)';

interface ChangeContext {
  projectKeys: Map<string, string>;
  typeNames: Map<string, string>;
}

/**
 * Quy trình theo loại việc: cấu hình ở cấp tổ chức (workspace) và ghi đè từng dự án.
 * Mọi thay đổi: (1) chuyển việc đang ở quy trình bị bỏ sang trạng thái đích trong CÙNG transaction (tăng version + lịch sử
 * STATUS), (2) thêm trạng thái mới còn thiếu vào cột các bảng của dự án bị ảnh hưởng, (3) bỏ cache của resolver — cả khi rollback.
 * `dryRun` chỉ lập bảng "việc sẽ chuyển", không ghi gì.
 */
@Injectable()
export class WorkflowSchemeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: WorkflowResolver,
    // Tuỳ chọn để spec dựng bằng 2 đối số vẫn chạy; Nest DI tiêm bản thật (bỏ cache quy tắc + báo người tạo quy tắc bị tắt).
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly access?: ProjectAccessService,
  ) {}

  // ----------------------------------------------------------------------------------------- tổ chức

  async getWorkspaceScheme(workspaceId: string): Promise<WorkspaceWorkflowSchemeDto> {
    const rows = await this.prisma.workspaceWorkflowScheme.findMany({
      where: { workspaceId },
      select: { issueTypeId: true, workflowId: true },
      orderBy: { issueType: { hierarchyLevel: 'desc' } },
    });
    return { items: rows, issueTypes: await this.schemeTypes(workspaceId) };
  }

  /** Loại việc của tổ chức (cấp phân cấp giảm dần: Epic trước, Sub-task cuối) cho bảng cấu hình. */
  private schemeTypes(workspaceId: string) {
    return this.prisma.issueType.findMany({
      where: { workspaceId },
      orderBy: [{ hierarchyLevel: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        key: true,
        color: true,
        isSubtask: true,
        hierarchyLevel: true,
      },
    });
  }

  async setWorkspaceScheme(
    workspaceId: string,
    actorId: string,
    input: SetWorkspaceSchemeInput,
    dryRun: boolean,
  ): Promise<WorkflowChangeDto> {
    const types = await this.prisma.issueType.findMany({
      where: { id: { in: input.items.map((i) => i.issueTypeId) }, workspaceId },
      select: { id: true, name: true },
    });
    if (types.length !== input.items.length) throw new NotFoundAppException('Loại việc');
    const workflowIds = [...new Set(input.items.map((i) => i.workflowId))];
    const found = await this.prisma.workflow.count({
      where: { id: { in: workflowIds }, workspaceId, isTemplate: false, projectId: null },
    });
    if (found !== workflowIds.length) throw new BusinessRuleException(WORKFLOW_NOT_SELECTABLE);
    await assertMapInWorkspace(this.prisma, workspaceId, [
      input.statusMap,
      ...Object.values(input.statusMapByType ?? {}),
    ]);

    const pick = (typeId: string, fromId: string) =>
      input.statusMapByType?.[typeId]?.[fromId] ?? input.statusMap?.[fromId];

    if (dryRun) {
      const plan = await this.planScheme(this.prisma, workspaceId, input, types);
      const moves = await planMoves(this.prisma, workspaceId, plan.scopes, pick);
      const rules = await ruleStepForMoves(
        this.prisma,
        workspaceId,
        this.rulePairs(plan, moves),
        pick,
        moves,
        true,
      );
      const refs = await this.nameRefs(this.prisma, workspaceId, moves, plan, {
        viewerId: actorId,
      });
      return this.result(true, moves, plan.ctx, rules, refs);
    }
    let result: WorkflowChangeDto;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // Khoá TRƯỚC khi đọc trạng thái hiện tại: hai thay đổi đồng thời xếp hàng và thấy kết quả của nhau (L2).
        await lockWorkspaceWorkflows(tx, workspaceId);
        const plan = await this.planScheme(tx, workspaceId, input, types);
        const moves = await planMoves(tx, workspaceId, plan.scopes, pick);
        assertAllMapped(moves, plan.ctx.typeNames);
        for (const i of plan.changed)
          await tx.workspaceWorkflowScheme.upsert({
            where: { workspaceId_issueTypeId: { workspaceId, issueTypeId: i.issueTypeId } },
            create: { workspaceId, issueTypeId: i.issueTypeId, workflowId: i.workflowId },
            update: { workflowId: i.workflowId },
          });
        await this.applyMoves(tx, workspaceId, actorId, moves);
        await this.syncBoards(tx, [...new Set(plan.scopes.flatMap((s) => s.projectIds))]);
        const rules = await ruleStepForMoves(
          tx,
          workspaceId,
          this.rulePairs(plan, moves),
          pick,
          moves,
          false,
        );
        const refs = await this.nameRefs(tx, workspaceId, moves, plan, { viewerId: actorId });
        return this.result(false, moves, plan.ctx, rules, refs);
      }, TX_OPTIONS);
    } finally {
      // Kể cả rollback: lần nạp giữa chừng trong transaction có thể đã vào cache của request.
      this.resolver.invalidate();
    }
    await publishRuleChanges(this.deps(), workspaceId, actorId, result.affectedRules);
    return result;
  }

  /** Đọc trạng thái hiện tại (bằng `db`: client thường để xem trước, tx đã khoá để chạy thật) và dựng phạm vi chuyển việc. */
  private async planScheme(
    db: Prisma.TransactionClient,
    workspaceId: string,
    input: SetWorkspaceSchemeInput,
    types: Array<{ id: string; name: string }>,
  ) {
    const current = new Map(
      (
        await db.workspaceWorkflowScheme.findMany({
          where: { workspaceId },
          select: { issueTypeId: true, workflowId: true },
        })
      ).map((r) => [r.issueTypeId, r.workflowId]),
    );
    const changed = input.items.filter((i) => current.get(i.issueTypeId) !== i.workflowId);
    // allow-deleted: việc của dự án đã xoá mềm/lưu trữ cũng phải khớp quy trình (khôi phục sau này không được lệch)
    const projects = await db.project.findMany({
      where: { workspaceId },
      select: { id: true, key: true, defaultWorkflowId: true },
    });
    const overridden = await db.projectWorkflowOverride.findMany({
      where: { issueTypeId: { in: changed.map((i) => i.issueTypeId) }, project: { workspaceId } },
      select: { projectId: true, issueTypeId: true },
    });
    const scopes: MoveScope[] = changed.map((i) => ({
      typeId: i.issueTypeId,
      toWorkflowId: i.workflowId,
      projectIds: projects
        .filter(
          (p) => !overridden.some((o) => o.projectId === p.id && o.issueTypeId === i.issueTypeId),
        )
        .map((p) => p.id),
    }));
    // Quy trình TRƯỚC đây của từng loại: dòng cấu hình cũ, hoặc (chưa có) quy trình mặc định của các dự án.
    const defaults = [
      ...new Set(projects.flatMap((p) => (p.defaultWorkflowId ? [p.defaultWorkflowId] : []))),
    ];
    const previous = new Map(
      changed.map((i) => [
        i.issueTypeId,
        current.has(i.issueTypeId) ? [current.get(i.issueTypeId)!] : defaults,
      ]),
    );
    const ctx: ChangeContext = {
      projectKeys: new Map(projects.map((p) => [p.id, p.key])),
      typeNames: new Map(types.map((t) => [t.id, t.name])),
    };
    return { changed, scopes, previous, ctx };
  }

  private rulePairs(
    plan: { scopes: MoveScope[]; previous: Map<string, string[]> },
    moves: PlannedMove[],
  ) {
    return plan.scopes.map((s) => ({
      typeId: s.typeId,
      toWorkflowId: s.toWorkflowId,
      fromWorkflowIds: fromWorkflowsOf(s.typeId, plan.previous.get(s.typeId) ?? [], moves),
    }));
  }

  private deps() {
    return { events: this.events, notifications: this.notifications };
  }

  // ----------------------------------------------------------------------------------------- dự án

  /** Quy trình hiệu lực của từng loại việc trong dự án: ghi đè → tổ chức → mặc định của dự án. */
  async getProjectScheme(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectWorkflowSchemeDto> {
    const project = await this.requireProject(workspaceId, projectId);
    const [types, overrides, scheme] = await Promise.all([
      this.prisma.issueType.findMany({ where: { workspaceId }, select: { id: true } }),
      this.prisma.projectWorkflowOverride.findMany({
        where: { projectId },
        select: { issueTypeId: true, workflowId: true },
      }),
      this.prisma.workspaceWorkflowScheme.findMany({
        where: { workspaceId },
        select: { issueTypeId: true, workflowId: true },
      }),
    ]);
    const ov = new Map(overrides.map((o) => [o.issueTypeId, o.workflowId]));
    const ws = new Map(scheme.map((s) => [s.issueTypeId, s.workflowId]));
    const items: ProjectWorkflowSchemeDto['items'] = [];
    for (const t of types) {
      const workspaceWorkflowId = ws.get(t.id) ?? null;
      const overrideId = ov.get(t.id);
      const workflowId = overrideId ?? workspaceWorkflowId ?? project.defaultWorkflowId;
      if (!workflowId) continue;
      items.push({
        issueTypeId: t.id,
        workflowId,
        isOverride: overrideId !== undefined,
        workspaceWorkflowId,
      });
    }
    return { projectId, items, issueTypes: await this.schemeTypes(workspaceId) };
  }

  /**
   * Dự án dùng quy trình riêng cho một loại việc. `workflowId = null` = quay về dùng chung (như DELETE).
   * `copy = true`: chép quy trình của tổ chức thành bản riêng của dự án (tên `<tên> (<MÃ>)`, dùng lại nếu đã chép) —
   * `statusMap` khi đó có thể trỏ vào trạng thái của quy trình NGUỒN, được đổi sang trạng thái cùng tên của bản chép.
   */
  async setProjectOverride(
    workspaceId: string,
    projectId: string,
    actorId: string,
    input: SetProjectOverrideInput,
    dryRun: boolean,
  ): Promise<WorkflowChangeDto> {
    if (input.workflowId === null)
      return this.clearProjectOverride(
        workspaceId,
        projectId,
        actorId,
        input.issueTypeId,
        input.statusMap,
        dryRun,
      );
    const workflowId = input.workflowId;
    await assertProjectIdWritable(this.prisma, projectId);
    const project = await this.requireProject(workspaceId, projectId);
    const type = await this.requireType(workspaceId, input.issueTypeId);
    await assertMapInWorkspace(this.prisma, workspaceId, [input.statusMap]);
    const source = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        workspaceId,
        isTemplate: false,
        OR: [{ projectId: null }, ...(input.copy ? [] : [{ projectId }])],
      },
      include: { statuses: true, transitions: true },
    });
    if (!source) throw new BusinessRuleException(WORKFLOW_NOT_SELECTABLE);
    const ctx: ChangeContext = {
      projectKeys: new Map([[projectId, project.key]]),
      typeNames: new Map([[type.id, type.name]]),
    };

    if (dryRun) {
      // Chép chưa xảy ra: xem trước theo trạng thái của quy trình NGUỒN (cùng tên/nhóm với bản chép sẽ tạo).
      const existingCopy = input.copy
        ? await this.findCopy(this.prisma, workspaceId, projectId, source.name, project.key)
        : null;
      const target = existingCopy?.id ?? source.id;
      const scope = [{ typeId: type.id, projectIds: [projectId], toWorkflowId: target }];
      const pick = (_t: string, from: string) => input.statusMap[from];
      const moves = await planMoves(this.prisma, workspaceId, scope, pick);
      const rules = await ruleStepForMoves(
        this.prisma,
        workspaceId,
        await this.overridePairs(this.prisma, projectId, type.id, target, moves),
        pick,
        moves,
        true,
        projectId,
      );
      const refs = await this.nameRefs(
        this.prisma,
        workspaceId,
        moves,
        { targets: [target], types: [type.id] },
        { viewerId: actorId, projectId },
      );
      return this.result(true, moves, ctx, rules, refs);
    }
    let result: WorkflowChangeDto;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await lockWorkspaceWorkflows(tx, workspaceId);
        // Đọc quy trình hiện tại TRƯỚC khi ghi (để biết quy trình cũ cần ánh xạ cho quy tắc).
        this.resolver.invalidate(projectId);
        const before = await this.overridePairs(tx, projectId, type.id, '', []);
        let targetId = source.id;
        let translate = (id: string | undefined) => id;
        if (input.copy) {
          const copy = await this.ensureCopy(tx, workspaceId, project, source);
          targetId = copy.id;
          translate = (id) => (id ? (copy.sourceToCopy.get(id) ?? id) : id);
        }
        const pick = (_t: string, from: string) => translate(input.statusMap[from]);
        const moves = await planMoves(
          tx,
          workspaceId,
          [{ typeId: type.id, projectIds: [projectId], toWorkflowId: targetId }],
          pick,
        );
        assertAllMapped(moves, ctx.typeNames);
        await tx.projectWorkflowOverride.upsert({
          where: { projectId_issueTypeId: { projectId, issueTypeId: type.id } },
          create: { projectId, issueTypeId: type.id, workflowId: targetId },
          update: { workflowId: targetId },
        });
        await this.applyMoves(tx, workspaceId, actorId, moves);
        await this.syncBoards(tx, [projectId]);
        const pairs = before.map((b) => ({
          ...b,
          toWorkflowId: targetId,
          fromWorkflowIds: fromWorkflowsOf(type.id, b.fromWorkflowIds, moves),
        }));
        const rules = await ruleStepForMoves(tx, workspaceId, pairs, pick, moves, false, projectId);
        const refs = await this.nameRefs(
          tx,
          workspaceId,
          moves,
          { targets: [targetId], types: [type.id] },
          { viewerId: actorId, projectId },
        );
        return this.result(false, moves, ctx, rules, refs);
      }, TX_OPTIONS);
    } finally {
      this.resolver.invalidate(projectId);
    }
    await publishRuleChanges(this.deps(), workspaceId, actorId, result.affectedRules);
    return result;
  }

  /** Cặp (loại việc, quy trình hiệu lực HIỆN TẠI của dự án → quy trình đích) cho bước quy tắc; `target` rỗng = chỉ lấy quy trình cũ. */
  private async overridePairs(
    db: Prisma.TransactionClient,
    projectId: string,
    typeId: string,
    target: string,
    moves: PlannedMove[],
  ): Promise<Array<{ typeId: string; fromWorkflowIds: string[]; toWorkflowId: string }>> {
    const { workflowId } = await this.resolver.forIssue(db, projectId, typeId);
    return [
      {
        typeId,
        toWorkflowId: target,
        fromWorkflowIds: fromWorkflowsOf(typeId, workflowId ? [workflowId] : [], moves),
      },
    ];
  }

  /** Quay về dùng chung: chuyển việc của loại đó sang quy trình của tổ chức (hoặc mặc định của dự án), rồi xoá ghi đè. */
  async clearProjectOverride(
    workspaceId: string,
    projectId: string,
    actorId: string,
    issueTypeId: string,
    statusMap: Record<string, string>,
    dryRun: boolean,
  ): Promise<WorkflowChangeDto> {
    await assertProjectIdWritable(this.prisma, projectId);
    const project = await this.requireProject(workspaceId, projectId);
    const type = await this.requireType(workspaceId, issueTypeId);
    await assertMapInWorkspace(this.prisma, workspaceId, [statusMap]);
    const ctx: ChangeContext = {
      projectKeys: new Map([[projectId, project.key]]),
      typeNames: new Map([[type.id, type.name]]),
    };
    const override = await this.prisma.projectWorkflowOverride.findUnique({
      where: { projectId_issueTypeId: { projectId, issueTypeId } },
      select: { id: true },
    });
    if (!override) return this.result(dryRun, [], ctx); // đã dùng chung — không có gì để làm (idempotent)
    const shared =
      (
        await this.prisma.workspaceWorkflowScheme.findUnique({
          where: { workspaceId_issueTypeId: { workspaceId, issueTypeId } },
          select: { workflowId: true },
        })
      )?.workflowId ?? project.defaultWorkflowId;
    if (!shared)
      throw new BusinessRuleException(
        'Loại việc này chưa có quy trình chung của tổ chức — hãy chọn quy trình cho tổ chức trước',
      );
    const scope: MoveScope[] = [
      { typeId: issueTypeId, projectIds: [projectId], toWorkflowId: shared },
    ];
    const pick = (_t: string, from: string) => statusMap[from];
    if (dryRun) {
      const moves = await planMoves(this.prisma, workspaceId, scope, pick);
      const rules = await ruleStepForMoves(
        this.prisma,
        workspaceId,
        await this.overridePairs(this.prisma, projectId, issueTypeId, shared, moves),
        pick,
        moves,
        true,
        projectId,
      );
      const refs = await this.nameRefs(
        this.prisma,
        workspaceId,
        moves,
        { targets: [shared], types: [issueTypeId] },
        { viewerId: actorId, projectId },
      );
      return this.result(true, moves, ctx, rules, refs);
    }
    let result: WorkflowChangeDto;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await lockWorkspaceWorkflows(tx, workspaceId);
        this.resolver.invalidate(projectId);
        const before = await this.overridePairs(tx, projectId, issueTypeId, shared, []);
        const moves = await planMoves(tx, workspaceId, scope, pick);
        assertAllMapped(moves, ctx.typeNames);
        await tx.projectWorkflowOverride.deleteMany({ where: { projectId, issueTypeId } });
        await this.applyMoves(tx, workspaceId, actorId, moves);
        await this.syncBoards(tx, [projectId]);
        const pairs = before.map((b) => ({
          ...b,
          fromWorkflowIds: fromWorkflowsOf(issueTypeId, b.fromWorkflowIds, moves),
        }));
        const rules = await ruleStepForMoves(tx, workspaceId, pairs, pick, moves, false, projectId);
        const refs = await this.nameRefs(
          tx,
          workspaceId,
          moves,
          { targets: [shared], types: [issueTypeId] },
          { viewerId: actorId, projectId },
        );
        return this.result(false, moves, ctx, rules, refs);
      }, TX_OPTIONS);
    } finally {
      this.resolver.invalidate(projectId);
    }
    await publishRuleChanges(this.deps(), workspaceId, actorId, result.affectedRules);
    return result;
  }

  // ----------------------------------------------------------------------------------------- helpers

  private async applyMoves(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    actorId: string,
    moves: PlannedMove[],
  ): Promise<void> {
    if (moves.length === 0) return;
    const resolution = await tx.resolution.findFirst({
      where: { workspaceId, isDefault: true },
      select: { id: true },
    });
    const historyActorId = await systemActorId(tx); // lịch sử ghi tên hệ thống, không phải quản trị viên
    for (const m of moves) {
      if (!m.to) continue; // đã bị assertAllMapped chặn; giữ để type-safe
      await moveIssuesToStatus(tx, {
        where: { workspaceId, typeId: m.typeId, projectId: m.projectId },
        from: m.from,
        to: m.to,
        actorId,
        historyActorId,
        defaultResolutionId: resolution?.id ?? null,
      });
    }
  }

  /** Thêm trạng thái của quy trình đang dùng còn thiếu vào cột các bảng, rồi gỡ trạng thái cũ không còn dùng và không còn việc (xem `pruneUnusedBoardStatuses`). */
  private async syncBoards(tx: Prisma.TransactionClient, projectIds: string[]): Promise<void> {
    for (const projectId of projectIds) {
      // Bỏ cache để đọc đúng cấu hình vừa ghi trong transaction này.
      this.resolver.invalidate(projectId);
      const inUse = [...new Set((await this.resolver.forProject(tx, projectId)).values())];
      await appendMissingBoardStatuses(tx, projectId, inUse);
      await pruneUnusedBoardStatuses(tx, projectId, inUse);
    }
  }

  private result(
    dryRun: boolean,
    moves: PlannedMove[],
    ctx: ChangeContext,
    affectedRules: AffectedRuleDto[] = [],
    nameRefs: NameRefDto[] = [],
  ): WorkflowChangeDto {
    const rows = toMoveRows(moves, { projects: ctx.projectKeys, types: ctx.typeNames });
    return {
      dryRun,
      moves: rows,
      totalIssues: rows.reduce((n, r) => n + r.count, 0),
      affectedRules,
      nameRefs,
    };
  }

  /**
   * Bộ lọc/bảng/widget/quy tắc/KR lọc theo TÊN trạng thái sẽ biến mất sau thay đổi này (chỉ báo, xem `findNameRefs`), giới hạn ở
   * những gì NGƯỜI GỌI thấy được (bộ lọc của mình/chia sẻ, bảng và quy tắc của dự án đang đổi…) — không lộ bộ lọc riêng tư hay
   * bảng của dự án riêng tư.
   */
  private async nameRefs(
    db: Prisma.TransactionClient,
    workspaceId: string,
    moves: PlannedMove[],
    plan:
      | { scopes: MoveScope[]; changed: Array<{ issueTypeId: string }> }
      | { targets: string[]; types: string[] },
    who: { viewerId: string; projectId?: string },
  ): Promise<NameRefDto[]> {
    const targets = 'scopes' in plan ? plan.scopes.map((s) => s.toWorkflowId) : plan.targets;
    const types = 'changed' in plan ? plan.changed.map((c) => c.issueTypeId) : plan.types;
    if (moves.length === 0) return [];
    const visibleProjectIds = this.access
      ? await this.access.visibleProjectIds(who.viewerId, workspaceId)
      : null;
    return findNameRefs(
      db,
      workspaceId,
      moves,
      await liveWorkflowIdsAfter(db, workspaceId, targets, types),
      { viewerId: who.viewerId, visibleProjectIds, projectId: who.projectId },
    );
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true, key: true, defaultWorkflowId: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    return project;
  }

  private async requireType(workspaceId: string, issueTypeId: string) {
    const type = await this.prisma.issueType.findFirst({
      where: { id: issueTypeId, workspaceId },
      select: { id: true, name: true },
    });
    if (!type) throw new NotFoundAppException('Loại việc');
    return type;
  }

  private copyName(sourceName: string, projectKey: string): string {
    return `${sourceName} (${projectKey})`;
  }

  private findCopy(
    db: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    sourceName: string,
    projectKey: string,
  ) {
    return db.workflow.findFirst({
      where: { workspaceId, projectId, name: this.copyName(sourceName, projectKey) },
      select: { id: true },
    });
  }

  /** Bản chép riêng của dự án (dùng lại nếu đã chép): trạng thái + bước chuyển; trả bảng id nguồn → id bản chép theo TÊN. */
  private async ensureCopy(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    project: { id: string; key: string },
    source: Prisma.WorkflowGetPayload<{ include: { statuses: true; transitions: true } }>,
  ): Promise<{ id: string; sourceToCopy: Map<string, string> }> {
    const existing = await tx.workflow.findFirst({
      where: {
        workspaceId,
        projectId: project.id,
        name: this.copyName(source.name, project.key),
      },
      include: { statuses: true },
    });
    if (existing) {
      const byName = new Map(existing.statuses.map((s) => [s.name, s.id]));
      return {
        id: existing.id,
        sourceToCopy: new Map(
          source.statuses.flatMap((s) => (byName.has(s.name) ? [[s.id, byName.get(s.name)!]] : [])),
        ),
      };
    }
    const wf = await tx.workflow.create({
      data: {
        workspaceId,
        projectId: project.id,
        name: this.copyName(source.name, project.key),
        description: source.description,
        isTemplate: false,
        isDefault: false,
      },
      select: { id: true },
    });
    const sourceToCopy = new Map<string, string>();
    for (const s of source.statuses) {
      const row = await tx.status.create({
        data: {
          workflowId: wf.id,
          name: s.name,
          category: s.category,
          color: s.color,
          order: s.order,
          isInitial: s.isInitial,
        },
        select: { id: true },
      });
      sourceToCopy.set(s.id, row.id);
    }
    for (const t of source.transitions)
      await tx.workflowTransition.create({
        data: {
          workflowId: wf.id,
          name: t.name,
          fromStatusId: t.fromStatusId ? (sourceToCopy.get(t.fromStatusId) ?? null) : null,
          toStatusId: sourceToCopy.get(t.toStatusId)!,
          order: t.order,
        },
      });
    return { id: wf.id, sourceToCopy };
  }
}
