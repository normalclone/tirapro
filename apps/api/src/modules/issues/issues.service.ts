import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createId } from '@paralleldrive/cuid2';
import { DOMAIN_EVENTS, PERMISSIONS, type IssueDto } from '@tirapro/types';
import { rankBetween, issueTypePrefix, type CreateIssueInput, type MoveIssueInput, type TransitionIssueInput, type UpdateIssueInput } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  InvalidTransitionException,
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { cursorPage, PageResult } from '../../common/dto/page-result';

const issueInclude = {
  type: true,
  status: true,
  priority: true,
  severity: true,
  resolution: true,
  assignee: true,
  reporter: true,
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

  /** Đảm bảo metadata/quan hệ (nếu truyền) thuộc đúng workspace — chống gán/liên kết chéo tenant. */
  private async assertMetaInWorkspace(
    workspaceId: string,
    m: {
      typeId?: string | null; priorityId?: string | null; sprintId?: string | null;
      resolutionId?: string | null; parentId?: string | null; epicId?: string | null;
    },
  ): Promise<void> {
    const jobs: Array<Promise<{ id: string } | null>> = [];
    if (m.typeId) jobs.push(this.prisma.issueType.findFirst({ where: { id: m.typeId, workspaceId }, select: { id: true } }));
    if (m.priorityId) jobs.push(this.prisma.priority.findFirst({ where: { id: m.priorityId, workspaceId }, select: { id: true } }));
    if (m.resolutionId) jobs.push(this.prisma.resolution.findFirst({ where: { id: m.resolutionId, workspaceId }, select: { id: true } }));
    if (m.sprintId) jobs.push(this.prisma.sprint.findFirst({ where: { id: m.sprintId, project: { workspaceId } }, select: { id: true } }));
    if (m.parentId) jobs.push(this.prisma.issue.findFirst({ where: { id: m.parentId, workspaceId, deletedAt: null }, select: { id: true } }));
    if (m.epicId) jobs.push(this.prisma.issue.findFirst({ where: { id: m.epicId, workspaceId, deletedAt: null }, select: { id: true } }));
    if (jobs.length && (await Promise.all(jobs)).some((r) => r == null)) {
      throw new NotFoundAppException('Thuộc tính/liên kết issue (loại/ưu tiên/sprint/resolution/cha/epic) không thuộc workspace này');
    }
  }

  async create(workspaceId: string, userId: string, input: CreateIssueInput): Promise<IssueDto> {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, workspaceId, deletedAt: null },
      select: { id: true, key: true, defaultWorkflowId: true, leadId: true, defaultAssigneeMode: true },
    });
    if (!project) throw new NotFoundAppException('Project');
    await this.assertMetaInWorkspace(workspaceId, {
      typeId: input.typeId, priorityId: input.priorityId, sprintId: input.sprintId,
      parentId: input.parentId, epicId: input.epicId,
    });

    // Status: input hoặc trạng thái initial của workflow project
    let statusId = input.statusId;
    if (!statusId) {
      const initial = await this.prisma.status.findFirst({
        where: { workflowId: project.defaultWorkflowId ?? '', isInitial: true },
        select: { id: true },
      });
      if (!initial) throw new BusinessRuleException('Project chưa cấu hình workflow/trạng thái khởi đầu');
      statusId = initial.id;
    }

    // Priority mặc định của workspace nếu không truyền
    let priorityId = input.priorityId ?? undefined;
    if (!priorityId) {
      const def = await this.prisma.priority.findFirst({ where: { workspaceId, isDefault: true }, select: { id: true } });
      priorityId = def?.id;
    }

    const assigneeId =
      input.assigneeId ?? (project.defaultAssigneeMode === 'PROJECT_LEAD' ? project.leadId : null);

    // Rank: cuối danh sách trong project
    const last = await this.prisma.issue.findFirst({
      where: { projectId: project.id, deletedAt: null },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    const rank = rankBetween(last?.rank ?? null, null);

    const issue = await this.prisma.$transaction(async (tx) => {
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
          statusId: statusId!,
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
    });

    const dto = this.toDto(issue);
    this.events.emit(DOMAIN_EVENTS.ISSUE_CREATED, { issue: dto, actorId: userId, clientId: input.clientId });
    return dto;
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
    if (!issue) throw new NotFoundAppException('Issue');
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

    const data: Prisma.IssueUpdateInput = { version: { increment: 1 }, updatedById: userId };
    if (input.summary !== undefined) data.summary = input.summary;
    if (input.description !== undefined) data.description = input.description;
    if (input.priorityId !== undefined) data.priority = input.priorityId ? { connect: { id: input.priorityId } } : { disconnect: true };
    if (input.assigneeId !== undefined) data.assignee = input.assigneeId ? { connect: { id: input.assigneeId } } : { disconnect: true };
    if (input.storyPoints !== undefined) data.storyPoints = input.storyPoints;
    if (input.sprintId !== undefined) data.sprint = input.sprintId ? { connect: { id: input.sprintId } } : { disconnect: true };
    if (input.resolutionId !== undefined) data.resolution = input.resolutionId ? { connect: { id: input.resolutionId } } : { disconnect: true };
    if (input.typeId !== undefined && input.typeId) data.type = { connect: { id: input.typeId } };
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    if (input.startDate !== undefined) data.startDate = input.startDate ? new Date(input.startDate) : null;
    if (input.parentId !== undefined) {
      if (input.parentId === id) throw new BusinessRuleException('Issue không thể là cha của chính nó');
      if (input.parentId) {
        await this.assertNoParentCycle(workspaceId, id, input.parentId);
        data.parent = { connect: { id: input.parentId } };
      } else {
        data.parent = { disconnect: true };
      }
    }

    const updated = await this.prisma.issue.update({ where: { id }, data, include: issueInclude });
    await this.recordChanges(userId, current, updated);
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, { issue: dto, actorId: userId });
    return dto;
  }

  async transition(workspaceId: string, userId: string, id: string, input: TransitionIssueInput): Promise<IssueDto> {
    const current = await this.requireIssue(workspaceId, id);
    this.assertVersion(current.version, input.version);
    await this.assertMetaInWorkspace(workspaceId, { resolutionId: input.resolutionId });
    if (current.statusId === input.toStatusId) return this.toDto(current);

    // Validate transition theo workflow của project
    const project = await this.prisma.project.findUnique({ where: { id: current.projectId }, select: { defaultWorkflowId: true } });
    const allowed = await this.prisma.workflowTransition.findFirst({
      where: {
        workflowId: project?.defaultWorkflowId ?? '',
        toStatusId: input.toStatusId,
        OR: [{ fromStatusId: current.statusId }, { fromStatusId: null }],
      },
      select: { id: true },
    });
    if (!allowed) throw new InvalidTransitionException();

    const toStatus = await this.prisma.status.findUnique({ where: { id: input.toStatusId }, select: { category: true } });
    const isDone = toStatus?.category === 'DONE';

    const updated = await this.prisma.issue.update({
      where: { id },
      data: {
        statusId: input.toStatusId,
        version: { increment: 1 },
        updatedById: userId,
        resolutionId: isDone ? (input.resolutionId ?? undefined) : null,
        resolvedAt: isDone ? new Date() : null,
      },
      include: issueInclude,
    });
    await this.prisma.issueHistory.create({
      data: {
        issueId: id, projectId: updated.projectId, sprintId: updated.sprintId,
        field: 'STATUS', oldValue: current.status.name, newValue: updated.status.name,
        oldCategory: current.status.category, newCategory: updated.status.category,
        actorId: userId, occurredAt: new Date(),
      },
    });
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.ISSUE_TRANSITIONED, { issue: dto, actorId: userId, fromStatusId: current.statusId });
    return dto;
  }

  async move(workspaceId: string, userId: string, id: string, input: MoveIssueInput): Promise<IssueDto> {
    const current = await this.requireIssue(workspaceId, id);
    this.assertVersion(current.version, input.version);
    await this.assertMetaInWorkspace(workspaceId, { sprintId: input.sprintId });

    const prevRank = input.afterId ? (await this.rankOf(input.afterId)) : null;
    const nextRank = input.beforeId ? (await this.rankOf(input.beforeId)) : null;
    const rank = rankBetween(prevRank, nextRank);

    const updated = await this.prisma.issue.update({
      where: { id },
      data: {
        rank,
        statusId: input.statusId ?? current.statusId,
        sprintId: input.sprintId !== undefined ? input.sprintId : current.sprintId,
        version: { increment: 1 },
        updatedById: userId,
      },
      include: issueInclude,
    });
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
    await this.prisma.issue.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId } });
    this.events.emit(DOMAIN_EVENTS.ISSUE_DELETED, { issueId: id, actorId: userId });
    return { success: true };
  }

  // ---------- helpers ----------
  private async requireIssue(workspaceId: string, id: string): Promise<IssueRow> {
    const issue = await this.prisma.issue.findFirst({ where: { id, workspaceId, deletedAt: null }, include: issueInclude });
    if (!issue) throw new NotFoundAppException('Issue');
    return issue;
  }

  /** Chặn vòng lặp cây: đi ngược từ parent mới lên gốc, không được gặp lại chính issue con. */
  private async assertNoParentCycle(workspaceId: string, childId: string, newParentId: string): Promise<void> {
    let cur: string | null = newParentId;
    let depth = 0;
    while (cur && depth < 200) {
      if (cur === childId) {
        throw new BusinessRuleException('Không thể đặt một issue con/cháu làm cha (sẽ tạo vòng lặp)');
      }
      const p: { parentId: string | null } | null = await this.prisma.issue.findFirst({
        where: { id: cur, workspaceId, deletedAt: null },
        select: { parentId: true },
      });
      cur = p?.parentId ?? null;
      depth += 1;
    }
  }

  private assertVersion(currentVersion: number, inputVersion: number) {
    if (currentVersion !== inputVersion) {
      throw new VersionConflictException('Issue đã được người khác cập nhật, hãy tải lại', { version: currentVersion });
    }
  }

  private async rankOf(id: string): Promise<string | null> {
    const r = await this.prisma.issue.findUnique({ where: { id }, select: { rank: true } });
    return r?.rank ?? null;
  }

  private async recordChanges(userId: string, before: IssueRow, after: IssueRow) {
    const rows: Prisma.IssueHistoryCreateManyInput[] = [];
    const base = { issueId: after.id, projectId: after.projectId, sprintId: after.sprintId, actorId: userId, occurredAt: new Date() };
    if (before.assigneeId !== after.assigneeId) rows.push({ ...base, field: 'ASSIGNEE', oldValue: before.assigneeId, newValue: after.assigneeId });
    if (before.priorityId !== after.priorityId) rows.push({ ...base, field: 'PRIORITY', oldValue: before.priority?.name, newValue: after.priority?.name });
    if (before.storyPoints !== after.storyPoints) rows.push({ ...base, field: 'STORY_POINTS', oldValue: String(before.storyPoints ?? ''), newValue: String(after.storyPoints ?? ''), pointsDelta: (after.storyPoints ?? 0) - (before.storyPoints ?? 0) });
    if (before.sprintId !== after.sprintId) rows.push({ ...base, field: 'SPRINT', oldValue: before.sprintId, newValue: after.sprintId });
    if (rows.length) await this.prisma.issueHistory.createMany({ data: rows });
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

  private userDto(u: { id: string; email: string; displayName: string; avatarUrl: string | null; timezone: string; locale: string; status: string; isSystemAdmin: boolean; lastSeenAt: Date | null; createdAt: Date }) {
    return { id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, timezone: u.timezone, locale: u.locale, status: u.status as never, isSystemAdmin: u.isSystemAdmin, lastSeenAt: u.lastSeenAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() };
  }
}
