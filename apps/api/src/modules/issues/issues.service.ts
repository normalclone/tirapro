import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, ERROR_CODES, PERMISSIONS, type BulkUpdateIssuesResult, type IssueDto, type UserStatus } from '@tirapro/types';
import { rankBetween, initialRanks, RankGapError, issueTypePrefix, type BulkUpdateIssuesInput, type CreateIssueInput, type MoveIssueInput, type TransitionIssueInput, type UpdateIssueInput } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import {
  AppException,
  BusinessRuleException,
  ForbiddenAppException,
  InvalidTransitionException,
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { cursorPage, PageResult } from '../../common/dto/page-result';

/** Chỉ các cột `userDto` dùng — không kéo passwordHash/mfa/... của user vào mọi truy vấn issue. */
const userSelect = {
  id: true, email: true, displayName: true, avatarUrl: true, timezone: true,
  locale: true, status: true, isSystemAdmin: true, lastSeenAt: true, createdAt: true,
} satisfies Prisma.UserSelect;

const issueInclude = {
  type: true,
  status: true,
  priority: true,
  severity: true,
  resolution: true,
  assignee: { select: userSelect },
  reporter: { select: userSelect },
  labels: { include: { label: true } },
} satisfies Prisma.IssueInclude;

type IssueRow = Prisma.IssueGetPayload<{ include: typeof issueInclude }>;

export interface IssueListFilter {
  projectId?: string;
  statusId?: string;
  assigneeId?: string;
  typeId?: string;
  sprintId?: string;
  search?: string;
}

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Story points & Hạn chỉ người TẠO/BÁO CÁO issue hoặc QUẢN TRỊ (project admin /
   * workspace admin / system admin) được sửa. Ném lỗi nếu vi phạm.
   */
  private async assertCanEditRestrictedFields(
    userId: string,
    workspaceId: string,
    issue: { reporterId: string | null; createdById: string | null; projectId: string },
  ): Promise<void> {
    if (issue.reporterId === userId || issue.createdById === userId) return;
    const perms = await this.rbac.getEffectivePermissions(userId, workspaceId, issue.projectId);
    if (perms.has(PERMISSIONS.PROJECT_ADMIN) || perms.has(PERMISSIONS.WORKSPACE_ADMIN)) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } });
    if (u?.isSystemAdmin) return;
    throw new ForbiddenAppException('Chỉ người tạo hoặc quản trị mới được sửa Story points/Hạn');
  }

  /** Cùng quy ước với PermissionsGuard: system admin, hoặc có `issue:transition` / `issue:transition:own`. */
  private async assertCanTransition(userId: string, workspaceId: string, projectId: string): Promise<void> {
    const perms = await this.rbac.getEffectivePermissions(userId, workspaceId, projectId);
    if (perms.has(PERMISSIONS.ISSUE_TRANSITION) || perms.has(`${PERMISSIONS.ISSUE_TRANSITION}:own`)) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } });
    if (u?.isSystemAdmin) return;
    throw new ForbiddenAppException('Bạn không có quyền chuyển trạng thái công việc — hãy bỏ phần đổi trạng thái hoặc nhờ quản trị cấp quyền');
  }

  /** Đảm bảo metadata/quan hệ (nếu truyền) thuộc đúng workspace — chống gán/liên kết chéo tenant. */
  private async assertMetaInWorkspace(
    workspaceId: string,
    m: {
      typeId?: string | null; priorityId?: string | null; sprintId?: string | null;
      resolutionId?: string | null; parentId?: string | null; epicId?: string | null;
    },
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const jobs: Array<Promise<{ id: string } | null>> = [];
    if (m.typeId) jobs.push(db.issueType.findFirst({ where: { id: m.typeId, workspaceId }, select: { id: true } }));
    if (m.priorityId) jobs.push(db.priority.findFirst({ where: { id: m.priorityId, workspaceId }, select: { id: true } }));
    if (m.resolutionId) jobs.push(db.resolution.findFirst({ where: { id: m.resolutionId, workspaceId }, select: { id: true } }));
    if (m.sprintId) jobs.push(db.sprint.findFirst({ where: { id: m.sprintId, project: { workspaceId } }, select: { id: true } }));
    if (m.parentId) jobs.push(db.issue.findFirst({ where: { id: m.parentId, workspaceId, deletedAt: null }, select: { id: true } }));
    if (m.epicId) jobs.push(db.issue.findFirst({ where: { id: m.epicId, workspaceId, deletedAt: null }, select: { id: true } }));
    if (jobs.length && (await Promise.all(jobs)).some((r) => r == null)) {
      throw new NotFoundAppException('Loại công việc, độ ưu tiên, sprint, kết quả xử lý, việc cha hoặc epic bạn chọn không thuộc không gian làm việc này — hãy chọn lại từ danh sách gợi ý');
    }
  }

  async create(workspaceId: string, userId: string, input: CreateIssueInput): Promise<IssueDto> {
    const dto = await this.createCore(null, workspaceId, userId, input);
    this.emitCreated(dto, userId, input.clientId);
    return dto;
  }

  /**
   * Tạo issue bên trong transaction của bên gọi (vd import theo lô). KHÔNG emit sự kiện —
   * bên gọi phải gọi `emitCreated` cho từng issue và chạy các hàm trong `deferred` (sự kiện đánh số lại
   * rank nếu có) SAU KHI transaction commit.
   */
  createWithin(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
    input: CreateIssueInput,
    deferred: Array<() => void> = [],
  ): Promise<IssueDto> {
    return this.createCore(tx, workspaceId, userId, input, deferred);
  }

  emitCreated(dto: IssueDto, actorId: string, clientId?: string): void {
    this.events.emit(DOMAIN_EVENTS.ISSUE_CREATED, { issue: dto, actorId, clientId });
  }

  private async createCore(
    outerTx: Prisma.TransactionClient | null,
    workspaceId: string,
    userId: string,
    input: CreateIssueInput,
    deferred: Array<() => void> | null = null,
  ): Promise<IssueDto> {
    const db: Prisma.TransactionClient = outerTx ?? this.prisma;
    const project = await db.project.findFirst({
      where: { id: input.projectId, workspaceId, deletedAt: null },
      select: { id: true, key: true, defaultWorkflowId: true, leadId: true, defaultAssigneeMode: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    await this.assertMetaInWorkspace(workspaceId, {
      typeId: input.typeId, priorityId: input.priorityId, sprintId: input.sprintId,
      parentId: input.parentId, epicId: input.epicId,
    }, db);

    // Status: input hoặc trạng thái initial của workflow project
    let statusId = input.statusId;
    if (!statusId) {
      const initial = await db.status.findFirst({
        where: { workflowId: project.defaultWorkflowId ?? '', isInitial: true },
        select: { id: true },
      });
      if (!initial) throw new BusinessRuleException('Project chưa cấu hình workflow/trạng thái khởi đầu');
      statusId = initial.id;
    }

    // Priority mặc định của workspace nếu không truyền
    let priorityId = input.priorityId ?? undefined;
    if (!priorityId) {
      const def = await db.priority.findFirst({ where: { workspaceId, isDefault: true }, select: { id: true } });
      priorityId = def?.id;
    }

    const assigneeId =
      input.assigneeId ?? (project.defaultAssigneeMode === 'PROJECT_LEAD' ? project.leadId : null);

    // Rank: cuối danh sách trong project
    const rank = await this.resolveRank(project.id, db, deferred, null, async () => {
      const last = await db.issue.findFirst({
        where: { projectId: project.id, deletedAt: null },
        orderBy: [{ rank: 'desc' }, { id: 'desc' }],
        select: { rank: true },
      });
      return { prev: last?.rank ?? null, next: null };
    });

    const body = async (tx: Prisma.TransactionClient) => {
      const updated = await tx.project.update({
        where: { id: project.id },
        data: { issueSequence: { increment: 1 } },
        select: { issueSequence: true },
      });
      const number = updated.issueSequence;
      // Mã issue = {mã dự án}-{loại}-{identity}: DEMO-BUG-1, DEMO-TASK-3…
      // identity đếm RIÊNG theo LOẠI trong TỪNG DỰ ÁN (per projectId+typeId).
      const type = await tx.issueType.findUnique({
        where: { id: input.typeId },
        select: { key: true, name: true },
      });
      const typeSeq = (await tx.issue.count({ where: { projectId: project.id, typeId: input.typeId } })) + 1;
      const key = `${project.key}-${issueTypePrefix(type?.key ?? null, type?.name ?? '')}-${typeSeq}`;
      const created = await tx.issue.create({
        data: {
          workspaceId,
          projectId: project.id,
          number,
          key,
          typeId: input.typeId,
          statusId,
          priorityId: priorityId ?? null,
          summary: input.summary,
          description: input.description ?? null,
          descriptionFormat: input.descriptionFormat,
          reporterId: userId,
          assigneeId: assigneeId ?? null,
          parentId: input.parentId ?? null,
          epicId: input.epicId ?? null,
          sprintId: input.sprintId ?? null,
          storyPoints: input.storyPoints ?? null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          startDate: input.startDate ? new Date(input.startDate) : null,
          rank,
          createdById: userId,
        },
        include: issueInclude,
      });
      if (input.labelIds?.length) {
        // Nhãn phải thuộc đúng dự án (⇒ đúng workspace) — chống gắn nhãn chéo tenant/chéo dự án.
        const ids = [...new Set(input.labelIds)];
        const valid = await tx.label.findMany({ where: { id: { in: ids }, projectId: project.id }, select: { id: true } });
        if (valid.length !== ids.length) throw new NotFoundAppException('Nhãn không thuộc dự án này');
        await tx.issueLabel.createMany({
          data: ids.map((labelId) => ({ issueId: created.id, labelId })),
          skipDuplicates: true,
        });
      }
      // History: trạng thái khởi tạo
      await tx.issueHistory.create({
        data: {
          issueId: created.id, projectId: project.id, sprintId: created.sprintId,
          field: 'STATUS', newValue: created.status.name, newCategory: created.status.category,
          actorId: userId, occurredAt: new Date(),
        },
      });
      return created;
    };
    const issue = outerTx ? await body(outerTx) : await this.prisma.$transaction(body);
    return this.toDto(issue);
  }

  async list(workspaceId: string, filter: IssueListFilter, cursor: string | undefined, limit: number): Promise<PageResult<IssueDto>> {
    const where: Prisma.IssueWhereInput = {
      workspaceId,
      deletedAt: null,
      projectId: filter.projectId,
      statusId: filter.statusId,
      assigneeId: filter.assigneeId,
      typeId: filter.typeId,
      sprintId: filter.sprintId,
      ...(filter.search ? { summary: { contains: filter.search, mode: 'insensitive' } } : {}),
    };
    const rows = await this.prisma.issue.findMany({
      where,
      include: issueInclude,
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return cursorPage(rows.map((r) => this.toDto(r)), limit, (i) => i.id);
  }

  /** Truy vấn theo where đã biên dịch (vd từ JQL/Search). Tự ghép workspace + soft-delete. */
  async query(
    workspaceId: string,
    where: Prisma.IssueWhereInput,
    orderBy: Prisma.IssueOrderByWithRelationInput[],
    cursor: string | undefined,
    limit: number,
  ): Promise<PageResult<IssueDto>> {
    const finalOrder: Prisma.IssueOrderByWithRelationInput[] = orderBy.length
      ? [...orderBy, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'asc' }];
    const rows = await this.prisma.issue.findMany({
      where: { AND: [{ workspaceId, deletedAt: null }, where] },
      include: issueInclude,
      orderBy: finalOrder,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return cursorPage(rows.map((r) => this.toDto(r)), limit, (i) => i.id);
  }

  async getByKey(workspaceId: string, key: string): Promise<IssueDto> {
    const issue = await this.prisma.issue.findFirst({ where: { workspaceId, key, deletedAt: null }, include: issueInclude });
    if (!issue) throw new NotFoundAppException('Công việc');
    return this.toDto(issue);
  }

  async update(workspaceId: string, userId: string, id: string, input: UpdateIssueInput): Promise<IssueDto> {
    const current = await this.requireIssue(workspaceId, id);
    this.assertVersion(current.version, input.version);
    await this.assertMetaInWorkspace(workspaceId, {
      typeId: input.typeId, priorityId: input.priorityId, sprintId: input.sprintId,
      resolutionId: input.resolutionId, parentId: input.parentId, epicId: input.epicId,
    });

    // Field-level: Story points / Hạn chỉ người tạo hoặc admin sửa được.
    if (input.storyPoints !== undefined || input.dueDate !== undefined) {
      await this.assertCanEditRestrictedFields(userId, workspaceId, current);
    }

    const data: Prisma.IssueUncheckedUpdateManyInput = { updatedById: userId };
    if (input.summary !== undefined) data.summary = input.summary;
    if (input.description !== undefined) data.description = input.description;
    if (input.priorityId !== undefined) data.priorityId = input.priorityId ?? null;
    if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId ?? null;
    if (input.storyPoints !== undefined) data.storyPoints = input.storyPoints;
    if (input.sprintId !== undefined) data.sprintId = input.sprintId ?? null;
    if (input.resolutionId !== undefined) data.resolutionId = input.resolutionId ?? null;
    if (input.typeId !== undefined && input.typeId) data.typeId = input.typeId;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    if (input.startDate !== undefined) data.startDate = input.startDate ? new Date(input.startDate) : null;
    if (input.parentId !== undefined) {
      if (input.parentId === id) throw new BusinessRuleException('Một công việc không thể là việc cha của chính nó — hãy chọn một công việc khác làm việc cha');
      if (input.parentId) await this.assertNoParentCycle(workspaceId, id, input.parentId);
      data.parentId = input.parentId ?? null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.updateWithVersion(tx, id, workspaceId, input.version, data);
      await this.recordChanges(tx, userId, current, row);
      return row;
    });
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, { issue: dto, actorId: userId });
    return dto;
  }

  /**
   * Sửa hàng loạt MỘT lô issue của cùng dự án trong một transaction. Item bị người khác sửa trước
   * (version lệch) không làm hỏng cả lô: được thu vào `conflicts` kèm version hiện tại.
   * Item không thuộc dự án/không gian làm việc, hoặc chuyển trạng thái sai workflow → lỗi cho cả yêu cầu, chưa ghi gì.
   * Sự kiện chỉ phát sau khi commit.
   */
  async bulkUpdate(workspaceId: string, userId: string, input: BulkUpdateIssuesInput): Promise<BulkUpdateIssuesResult> {
    const { projectId, items, patch } = input;
    // Đổi trạng thái chỉ đi qua quyền chuyển trạng thái (giống POST :id/transition), không đi chung quyền sửa.
    if (patch.statusId) await this.assertCanTransition(userId, workspaceId, projectId);
    const rows = await this.prisma.issue.findMany({
      where: { id: { in: items.map((i) => i.id) }, workspaceId, projectId, deletedAt: null },
      include: issueInclude,
    });
    if (rows.length !== items.length) throw new NotFoundAppException('Công việc');
    const byId = new Map(rows.map((r) => [r.id, r]));
    await this.assertMetaInWorkspace(workspaceId, { priorityId: patch.priorityId, sprintId: patch.sprintId });

    // Chuyển trạng thái: kiểm tra workflow đúng như transition() trước khi ghi bất cứ thứ gì.
    let toDone = false;
    if (patch.statusId) {
      const workflowId = await this.workflowIdOf(projectId);
      for (const r of rows) {
        if (r.statusId !== patch.statusId) await this.assertTransitionAllowed(workflowId, r.statusId, patch.statusId);
      }
      toDone = (await this.statusCategory(patch.statusId)) === 'DONE';
    }

    const conflicts: BulkUpdateIssuesResult['conflicts'] = [];
    const changed: Array<{ before: IssueRow; after: IssueRow }> = [];
    const result: IssueRow[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const before = byId.get(item.id)!;
        // Version đã lệch ngay từ lúc đọc: không cần ghi. Nếu khớp lúc đọc mà ghi thất bại thì updateWithVersion báo conflict.
        if (before.version !== item.version) {
          conflicts.push({ id: item.id, version: before.version });
          continue;
        }
        const statusChanged = patch.statusId !== undefined && patch.statusId !== before.statusId;
        const data: Prisma.IssueUncheckedUpdateManyInput = {};
        if (statusChanged) {
          data.statusId = patch.statusId;
          data.resolutionId = toDone ? undefined : null;
          data.resolvedAt = toDone ? new Date() : null;
        }
        if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) data.assigneeId = patch.assigneeId;
        if (patch.priorityId !== undefined && patch.priorityId !== before.priorityId) data.priorityId = patch.priorityId;
        if (patch.sprintId !== undefined && patch.sprintId !== before.sprintId) data.sprintId = patch.sprintId;
        if (Object.keys(data).length === 0) {
          result.push(before); // không có gì khác đi — coi như đã đạt, không tăng version
          continue;
        }
        data.updatedById = userId;
        try {
          const after = await this.updateWithVersion(tx, item.id, workspaceId, item.version, data);
          await this.recordChanges(tx, userId, before, after);
          if (statusChanged) await this.recordStatusChange(tx, userId, before, after);
          changed.push({ before, after });
          result.push(after);
        } catch (e) {
          if (!(e instanceof VersionConflictException)) throw e;
          conflicts.push({ id: item.id, version: (e.current as { version: number }).version });
        }
      }
    });

    for (const { before, after } of changed) {
      const dto = this.toDto(after);
      if (before.statusId !== after.statusId) {
        this.events.emit(DOMAIN_EVENTS.ISSUE_TRANSITIONED, { issue: dto, actorId: userId, fromStatusId: before.statusId });
      } else {
        this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, { issue: dto, actorId: userId });
      }
    }
    return { updated: result.map((r) => this.toDto(r)), conflicts };
  }

  async transition(workspaceId: string, userId: string, id: string, input: TransitionIssueInput): Promise<IssueDto> {
    const current = await this.requireIssue(workspaceId, id);
    this.assertVersion(current.version, input.version);
    await this.assertMetaInWorkspace(workspaceId, { resolutionId: input.resolutionId });
    if (current.statusId === input.toStatusId) return this.toDto(current);

    // Validate transition theo workflow của project
    const workflowId = await this.workflowIdOf(current.projectId);
    await this.assertTransitionAllowed(workflowId, current.statusId, input.toStatusId);

    const isDone = (await this.statusCategory(input.toStatusId)) === 'DONE';

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.updateWithVersion(tx, id, workspaceId, input.version, {
        statusId: input.toStatusId,
        updatedById: userId,
        resolutionId: isDone ? (input.resolutionId ?? undefined) : null,
        resolvedAt: isDone ? new Date() : null,
      });
      await this.recordStatusChange(tx, userId, current, row);
      return row;
    });
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.ISSUE_TRANSITIONED, { issue: dto, actorId: userId, fromStatusId: current.statusId });
    return dto;
  }

  async move(workspaceId: string, userId: string, id: string, input: MoveIssueInput): Promise<IssueDto> {
    const current = await this.requireIssue(workspaceId, id);
    this.assertVersion(current.version, input.version);
    await this.assertMetaInWorkspace(workspaceId, { sprintId: input.sprintId });

    const rank = await this.resolveRank(current.projectId, this.prisma, null, id, async () => ({
      prev: input.afterId ? await this.rankOf(workspaceId, current.projectId, input.afterId) : null,
      next: input.beforeId ? await this.rankOf(workspaceId, current.projectId, input.beforeId) : null,
    }));

    const updated = await this.prisma.$transaction((tx) =>
      this.updateWithVersion(tx, id, workspaceId, input.version, {
        rank,
        statusId: input.statusId ?? current.statusId,
        sprintId: input.sprintId !== undefined ? input.sprintId : current.sprintId,
        updatedById: userId,
      }),
    );
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.ISSUE_MOVED, {
      issueId: id, projectId: updated.projectId, fromStatusId: current.statusId,
      toStatusId: updated.statusId, rank, sprintId: updated.sprintId, version: updated.version, actorId: userId,
    });
    return dto;
  }

  /** Soft-delete (vào Recycle Bin). */
  async softDelete(workspaceId: string, userId: string, id: string): Promise<{ success: true }> {
    await this.requireIssue(workspaceId, id);
    // updateMany + deletedAt:null để hai lần xoá đồng thời chỉ một lần thắng (và chỉ phát sự kiện một lần).
    const { count } = await this.prisma.issue.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), updatedById: userId, version: { increment: 1 } },
    });
    if (count === 0) throw new NotFoundAppException('Công việc');
    this.events.emit(DOMAIN_EVENTS.ISSUE_DELETED, { issueId: id, actorId: userId });
    return { success: true };
  }

  // ---------- helpers ----------
  private async requireIssue(workspaceId: string, id: string): Promise<IssueRow> {
    const issue = await this.prisma.issue.findFirst({ where: { id, workspaceId, deletedAt: null }, include: issueInclude });
    if (!issue) throw new NotFoundAppException('Công việc');
    return issue;
  }

  /** Chặn vòng lặp cây: đi ngược từ parent mới lên gốc, không được gặp lại chính issue con. */
  private async assertNoParentCycle(workspaceId: string, childId: string, newParentId: string): Promise<void> {
    let cur: string | null = newParentId;
    let depth = 0;
    while (cur && depth < 200) {
      if (cur === childId) {
        throw new BusinessRuleException('Không thể chọn việc con (hoặc việc cháu) làm việc cha vì sẽ tạo vòng lặp — hãy chọn một công việc ngoài nhánh này');
      }
      const p: { parentId: string | null } | null = await this.prisma.issue.findFirst({
        where: { id: cur, workspaceId, deletedAt: null },
        select: { parentId: true },
      });
      cur = p?.parentId ?? null;
      depth += 1;
    }
  }

  private async workflowIdOf(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { defaultWorkflowId: true } });
    return project?.defaultWorkflowId ?? '';
  }

  /** Chỉ cho chuyển sang `toStatusId` nếu workflow có transition từ trạng thái hiện tại (hoặc từ "bất kỳ"). */
  private async assertTransitionAllowed(workflowId: string, fromStatusId: string, toStatusId: string): Promise<void> {
    const allowed = await this.prisma.workflowTransition.findFirst({
      where: { workflowId, toStatusId, OR: [{ fromStatusId }, { fromStatusId: null }] },
      select: { id: true },
    });
    if (!allowed) throw new InvalidTransitionException();
  }

  private async statusCategory(statusId: string) {
    return (await this.prisma.status.findUnique({ where: { id: statusId }, select: { category: true } }))?.category;
  }

  private async recordStatusChange(tx: Prisma.TransactionClient, userId: string, before: IssueRow, after: IssueRow) {
    await tx.issueHistory.create({
      data: {
        issueId: after.id, projectId: after.projectId, sprintId: after.sprintId,
        field: 'STATUS', oldValue: before.status.name, newValue: after.status.name,
        oldCategory: before.status.category, newCategory: after.status.category,
        actorId: userId, occurredAt: new Date(),
      },
    });
  }

  /** Ghi có điều kiện version (OCC atomic). Trả row mới; ném VersionConflict nếu version đã đổi. */
  private async updateWithVersion(
    tx: Prisma.TransactionClient,
    id: string,
    workspaceId: string,
    version: number,
    data: Prisma.IssueUncheckedUpdateManyInput,
  ): Promise<IssueRow> {
    const { count } = await tx.issue.updateMany({
      where: { id, workspaceId, deletedAt: null, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) {
      const cur = await tx.issue.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { version: true } });
      if (!cur) throw new NotFoundAppException('Công việc');
      throw new VersionConflictException('Người khác vừa sửa công việc này — hãy tải lại để xem bản mới nhất rồi thao tác lại', { version: cur.version });
    }
    return tx.issue.findFirstOrThrow({ where: { id }, include: issueInclude });
  }

  private assertVersion(currentVersion: number, inputVersion: number) {
    if (currentVersion !== inputVersion) {
      throw new VersionConflictException('Người khác vừa sửa công việc này — hãy tải lại để xem bản mới nhất rồi thao tác lại', { version: currentVersion });
    }
  }

  /** Rank của issue làm mốc — phải còn sống và cùng workspace/project, nếu không thì báo lỗi thay vì lặng lẽ xếp xuống cuối. */
  private async rankOf(workspaceId: string, projectId: string, id: string): Promise<string> {
    const r = await this.prisma.issue.findFirst({ where: { id, workspaceId, projectId, deletedAt: null }, select: { rank: true } });
    if (!r) throw new AppException(ERROR_CODES.NOT_FOUND, 'Công việc làm mốc không tồn tại — hãy tải lại trang', HttpStatus.NOT_FOUND);
    return r.rank;
  }

  /**
   * Tính rank mới. Hết chỗ chèn (RankGapError) thì đánh số lại cả project rồi đọc lại
   * hai mốc và tính lại đúng 1 lần.
   */
  private async resolveRank(
    projectId: string,
    db: Prisma.TransactionClient,
    deferred: Array<() => void> | null,
    movedId: string | null,
    read: () => Promise<{ prev: string | null; next: string | null }>,
  ): Promise<string> {
    const first = await read();
    try {
      return rankBetween(first.prev, first.next);
    } catch (e) {
      if (!(e instanceof RankGapError)) throw e;
    }
    await this.rebalanceProject(projectId, db, deferred, movedId);
    const again = await read();
    try {
      return rankBetween(again.prev, again.next);
    } catch (e) {
      if (!(e instanceof RankGapError)) throw e;
      throw new BusinessRuleException('Không xác định được vị trí thả — hãy tải lại trang rồi thử kéo thả lại');
    }
  }

  /**
   * Đánh số lại rank toàn bộ issue của project (khi hết chỗ chèn). Khoá project bằng update để tuần tự hoá,
   * rồi ghi MỘT câu UPDATE cho cả project (không update từng dòng — tránh vượt timeout transaction).
   * `version` của các dòng (trừ issue đang kéo) được tăng để client đang giữ bản cũ bị OCC chặn thay vì ghi đè rank mới.
   * Sự kiện PROJECT_RANKS_REBALANCED chỉ phát sau khi commit: ngay khi tự mở transaction, hoặc chạy qua
   * `deferred` khi đang nằm trong transaction của bên gọi.
   */
  private async rebalanceProject(
    projectId: string,
    db: Prisma.TransactionClient,
    deferred: Array<() => void> | null,
    movedId: string | null,
  ): Promise<void> {
    const body = async (tx: Prisma.TransactionClient) => {
      await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() }, select: { id: true } });
      const rows = await tx.issue.findMany({ where: { projectId }, orderBy: [{ rank: 'asc' }, { id: 'asc' }], select: { id: true } });
      if (!rows.length) return;
      const ids = rows.map((r) => r.id);
      const ranks = initialRanks(rows.length);
      // Issue đang được kéo (movedId) KHÔNG tăng version ở đây: updateWithVersion của chính thao tác kéo sẽ tăng,
      // và nó phải còn khớp version client gửi lên. updatedAt cập nhật tay vì @updatedAt của Prisma chỉ chạy phía client.
      await tx.$executeRaw`
        UPDATE "Issue" AS i
        SET "rank" = v.rank,
            "version" = i."version" + CASE WHEN i."id" = ${movedId}::text THEN 0 ELSE 1 END,
            "updatedAt" = now()
        FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${ranks}::text[]) AS rank) AS v
        WHERE i."id" = v.id`;
    };
    const notify = () => this.events.emit(DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED, { projectId });
    // Đang trong transaction của bên gọi (import) thì chạy thẳng trong đó; không thì tự mở transaction riêng.
    if (db === (this.prisma as Prisma.TransactionClient)) {
      await this.prisma.$transaction(body, { timeout: 30_000 });
      notify();
    } else {
      await body(db);
      if (deferred) deferred.push(notify);
      else notify();
    }
  }

  private async recordChanges(tx: Prisma.TransactionClient, userId: string, before: IssueRow, after: IssueRow) {
    const rows: Prisma.IssueHistoryCreateManyInput[] = [];
    const base = { issueId: after.id, projectId: after.projectId, sprintId: after.sprintId, actorId: userId, occurredAt: new Date() };
    if (before.assigneeId !== after.assigneeId) rows.push({ ...base, field: 'ASSIGNEE', oldValue: before.assigneeId, newValue: after.assigneeId });
    if (before.priorityId !== after.priorityId) rows.push({ ...base, field: 'PRIORITY', oldValue: before.priority?.name, newValue: after.priority?.name });
    if (before.storyPoints !== after.storyPoints) rows.push({ ...base, field: 'STORY_POINTS', oldValue: String(before.storyPoints ?? ''), newValue: String(after.storyPoints ?? ''), pointsDelta: (after.storyPoints ?? 0) - (before.storyPoints ?? 0) });
    if (before.sprintId !== after.sprintId) rows.push({ ...base, field: 'SPRINT', oldValue: before.sprintId, newValue: after.sprintId });
    if (rows.length) await tx.issueHistory.createMany({ data: rows });
  }

  private toDto(i: IssueRow): IssueDto {
    return {
      id: i.id,
      key: i.key,
      summary: i.summary,
      type: { id: i.type.id, name: i.type.name, key: i.type.key, iconUrl: i.type.iconUrl, color: i.type.color, hierarchyLevel: i.type.hierarchyLevel, isSubtask: i.type.isSubtask },
      status: { id: i.status.id, workflowId: i.status.workflowId, name: i.status.name, category: i.status.category, color: i.status.color, order: i.status.order, isInitial: i.status.isInitial },
      priority: i.priority ? { id: i.priority.id, name: i.priority.name, iconKey: i.priority.iconKey, color: i.priority.color, rank: i.priority.rank, isDefault: i.priority.isDefault } : null,
      assignee: i.assignee ? this.userDto(i.assignee) : null,
      workspaceId: i.workspaceId,
      projectId: i.projectId,
      number: i.number,
      description: i.description,
      descriptionFormat: i.descriptionFormat,
      reporter: i.reporter ? this.userDto(i.reporter) : null,
      reporterId: i.reporterId,
      assigneeId: i.assigneeId,
      parentId: i.parentId,
      epicId: i.epicId,
      sprintId: i.sprintId,
      storyPoints: i.storyPoints,
      originalEstimate: i.originalEstimate,
      remainingEstimate: i.remainingEstimate,
      timeSpent: i.timeSpent,
      dueDate: i.dueDate?.toISOString() ?? null,
      startDate: i.startDate?.toISOString() ?? null,
      resolution: i.resolution ? { id: i.resolution.id, name: i.resolution.name, description: i.resolution.description, rank: i.resolution.rank } : null,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      severity: i.severity ? { id: i.severity.id, name: i.severity.name, description: i.severity.description, color: i.severity.color, rank: i.severity.rank, isDefault: i.severity.isDefault } : null,
      triageState: i.triageState,
      triageSnoozeUntil: i.triageSnoozeUntil?.toISOString() ?? null,
      occurrenceCount: i.occurrenceCount,
      rank: i.rank,
      version: i.version,
      labels: i.labels.map((l) => ({ id: l.label.id, projectId: l.label.projectId, name: l.label.name, color: l.label.color })),
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  }

  private userDto(u: { id: string; email: string; displayName: string; avatarUrl: string | null; timezone: string; locale: string; status: UserStatus; isSystemAdmin: boolean; lastSeenAt: Date | null; createdAt: Date }) {
    return { id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, timezone: u.timezone, locale: u.locale, status: u.status, isSystemAdmin: u.isSystemAdmin, lastSeenAt: u.lastSeenAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() };
  }
}
