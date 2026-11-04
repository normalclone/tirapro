import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ProjectWorkflowSchemeDto,
  WorkflowChangeDto,
  WorkspaceWorkflowSchemeDto,
} from '@tirapro/types';
import type { SetProjectOverrideInput, SetWorkspaceSchemeInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertProjectIdWritable } from '../../common/project-writable';
import { appendMissingBoardStatuses } from './board-columns-sync';
import { moveIssuesToStatus } from './issue-status-move';
import {
  assertAllMapped,
  assertMapInWorkspace,
  planMoves,
  toMoveRows,
  type MoveScope,
  type PlannedMove,
} from './workflow-move';
import { WorkflowResolver } from './workflow-resolver.service';

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
  ) {}

  // ----------------------------------------------------------------------------------------- tổ chức

  async getWorkspaceScheme(workspaceId: string): Promise<WorkspaceWorkflowSchemeDto> {
    const rows = await this.prisma.workspaceWorkflowScheme.findMany({
      where: { workspaceId },
      select: { issueTypeId: true, workflowId: true },
      orderBy: { issueType: { hierarchyLevel: 'desc' } },
    });
    return { items: rows };
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

    const current = new Map(
      (
        await this.prisma.workspaceWorkflowScheme.findMany({
          where: { workspaceId },
          select: { issueTypeId: true, workflowId: true },
        })
      ).map((r) => [r.issueTypeId, r.workflowId]),
    );
    const changed = input.items.filter((i) => current.get(i.issueTypeId) !== i.workflowId);
    // allow-deleted: việc của dự án đã xoá mềm/lưu trữ cũng phải khớp quy trình (khôi phục sau này không được lệch)
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { id: true, key: true },
    });
    const overridden = await this.prisma.projectWorkflowOverride.findMany({
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
    const pick = (typeId: string, fromId: string) =>
      input.statusMapByType?.[typeId]?.[fromId] ?? input.statusMap?.[fromId];
    const ctx: ChangeContext = {
      projectKeys: new Map(projects.map((p) => [p.id, p.key])),
      typeNames: new Map(types.map((t) => [t.id, t.name])),
    };

    if (dryRun) {
      return this.result(true, await planMoves(this.prisma, workspaceId, scopes, pick), ctx);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const moves = await planMoves(tx, workspaceId, scopes, pick);
        assertAllMapped(moves, ctx.typeNames);
        for (const i of changed)
          await tx.workspaceWorkflowScheme.upsert({
            where: { workspaceId_issueTypeId: { workspaceId, issueTypeId: i.issueTypeId } },
            create: { workspaceId, issueTypeId: i.issueTypeId, workflowId: i.workflowId },
            update: { workflowId: i.workflowId },
          });
        await this.applyMoves(tx, workspaceId, actorId, moves);
        const projectIds = [...new Set(scopes.flatMap((s) => s.projectIds))];
        await this.syncBoards(tx, projectIds);
        return this.result(false, moves, ctx);
      }, TX_OPTIONS);
    } finally {
      // Kể cả rollback: lần nạp giữa chừng trong transaction có thể đã vào cache của request.
      this.resolver.invalidate();
    }
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
    return { projectId, items };
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
      const moves = await planMoves(
        this.prisma,
        workspaceId,
        [{ typeId: type.id, projectIds: [projectId], toWorkflowId: target }],
        (_t, from) => input.statusMap[from],
      );
      return this.result(true, moves, ctx);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        let targetId = source.id;
        let translate = (id: string | undefined) => id;
        if (input.copy) {
          const copy = await this.ensureCopy(tx, workspaceId, project, source);
          targetId = copy.id;
          translate = (id) => (id ? (copy.sourceToCopy.get(id) ?? id) : id);
        }
        const moves = await planMoves(
          tx,
          workspaceId,
          [{ typeId: type.id, projectIds: [projectId], toWorkflowId: targetId }],
          (_t, from) => translate(input.statusMap[from]),
        );
        assertAllMapped(moves, ctx.typeNames);
        await tx.projectWorkflowOverride.upsert({
          where: { projectId_issueTypeId: { projectId, issueTypeId: type.id } },
          create: { projectId, issueTypeId: type.id, workflowId: targetId },
          update: { workflowId: targetId },
        });
        await this.applyMoves(tx, workspaceId, actorId, moves);
        await this.syncBoards(tx, [projectId]);
        return this.result(false, moves, ctx);
      }, TX_OPTIONS);
    } finally {
      this.resolver.invalidate(projectId);
    }
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
    if (dryRun)
      return this.result(true, await planMoves(this.prisma, workspaceId, scope, pick), ctx);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const moves = await planMoves(tx, workspaceId, scope, pick);
        assertAllMapped(moves, ctx.typeNames);
        await tx.projectWorkflowOverride.deleteMany({ where: { projectId, issueTypeId } });
        await this.applyMoves(tx, workspaceId, actorId, moves);
        await this.syncBoards(tx, [projectId]);
        return this.result(false, moves, ctx);
      }, TX_OPTIONS);
    } finally {
      this.resolver.invalidate(projectId);
    }
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
    for (const m of moves) {
      if (!m.to) continue; // đã bị assertAllMapped chặn; giữ để type-safe
      await moveIssuesToStatus(tx, {
        where: { workspaceId, typeId: m.typeId, projectId: m.projectId },
        from: m.from,
        to: m.to,
        actorId,
        defaultResolutionId: resolution?.id ?? null,
      });
    }
  }

  /** Thêm trạng thái của quy trình đang dùng còn thiếu vào cột các bảng (xem `appendMissingBoardStatuses`). */
  private async syncBoards(tx: Prisma.TransactionClient, projectIds: string[]): Promise<void> {
    for (const projectId of projectIds) {
      // Bỏ cache để đọc đúng cấu hình vừa ghi trong transaction này.
      this.resolver.invalidate(projectId);
      const inUse = [...new Set((await this.resolver.forProject(tx, projectId)).values())];
      await appendMissingBoardStatuses(tx, projectId, inUse);
    }
  }

  private result(dryRun: boolean, moves: PlannedMove[], ctx: ChangeContext): WorkflowChangeDto {
    const rows = toMoveRows(moves, { projects: ctx.projectKeys, types: ctx.typeNames });
    return { dryRun, moves: rows, totalIssues: rows.reduce((n, r) => n + r.count, 0) };
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
