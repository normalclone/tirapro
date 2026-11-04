import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type { StatusCategory } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ConflictAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { ERROR_CODES, type AffectedRuleDto, type WorkflowUsageDto } from '@tirapro/types';
import { moveIssuesToStatus } from './issue-status-move';
import { systemActorId } from './system-actor';
import { lockWorkspaceWorkflows } from './workflow-move';
import { publishRuleChanges, rewriteRuleStatusRefs } from './rule-status-refs';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowResolver } from './workflow-resolver.service';
import { assertProjectIdWritable } from '../../common/project-writable';
import { ProjectAccessService } from '../rbac/project-access.service';

// ---------------------------------------------------------------------------
// DTOs trả về (config-driven: board & validate transition đọc các bản ghi này)
// ---------------------------------------------------------------------------

export interface StatusDto {
  id: string;
  workflowId: string;
  name: string;
  category: StatusCategory;
  color: string | null;
  order: number;
  isInitial: boolean;
}

export interface TransitionDto {
  id: string;
  workflowId: string;
  name: string;
  fromStatusId: string | null;
  toStatusId: string;
  order: number;
}

export interface WorkflowDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  isTemplate: boolean;
  isDefault: boolean;
  sourceTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
  statuses: StatusDto[];
  transitions: TransitionDto[];
  /**
   * Nơi quy trình đang được dùng: loại việc của tổ chức (`scheme`), ghi đè của dự án (`overrides`) và dự án dùng làm quy
   * trình mặc định (`projects`). Chỉ gồm dự án người xem thấy được (dự án riêng tư người ngoài không lộ khoá/tên).
   */
  usedBy: WorkflowUsageDto;
  /**
   * Số dự án (riêng tư, người xem không thấy) cũng đang dùng quy trình này — để UI hiện "+N dự án riêng tư" và vẫn
   * giải thích vì sao quy trình không xoá được mà không lộ khoá/tên.
   */
  hiddenCount: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ListWorkflowsFilter {
  projectId?: string;
  isTemplate?: boolean;
  /** Mặc định quy trình của dự án đã xoá mềm (`project.deletedAt != null`) bị ẩn; `true` = vẫn liệt kê. */
  includeTrashed?: boolean;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  projectId?: string;
  isTemplate?: boolean;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
}

export interface CreateStatusInput {
  name: string;
  category: StatusCategory;
  color?: string;
  order?: number;
  isInitial?: boolean;
}

export interface UpdateStatusInput {
  name?: string;
  category?: StatusCategory;
  color?: string;
  order?: number;
  isInitial?: boolean;
}

export interface CreateTransitionInput {
  name: string;
  fromStatusId?: string | null;
  toStatusId: string;
  order?: number;
}

export interface UpdateTransitionInput {
  name?: string;
  fromStatusId?: string | null;
  toStatusId?: string;
  order?: number;
}

const workflowInclude = {
  statuses: { orderBy: { order: 'asc' } },
  transitions: { orderBy: { order: 'asc' } },
} satisfies Prisma.WorkflowInclude;

type WorkflowRow = Prisma.WorkflowGetPayload<{ include: typeof workflowInclude }>;
/** Dự án dùng một quy trình, tách theo người xem: thấy được (`usedBy`) và không thấy (`hiddenCount`). */
interface UsedBy {
  usage: WorkflowUsageDto;
  hiddenCount: number;
}
const emptyUsage = (): WorkflowUsageDto => ({
  scheme: [],
  overrides: [],
  projects: [],
  hiddenOverrideCount: 0,
});
type StatusRow = Prisma.StatusGetPayload<true>;
type TransitionRow = Prisma.WorkflowTransitionGetPayload<true>;

const WORKFLOW_DUPLICATE = 'Đã có quy trình trùng tên — hãy đặt tên khác';
const STATUS_DUPLICATE = 'Tên trạng thái đã tồn tại trong quy trình';
const workflowInUse = (keys: string[]) =>
  `Quy trình đang được dự án {${keys.join(', ')}} dùng — dự án (kể cả dự án đã xoá) vẫn giữ quy trình này nên không xoá được`;
const STATUS_HAS_ISSUES_MESSAGE =
  'Vẫn còn công việc đang ở trạng thái này — hãy chọn trạng thái thay thế để chuyển chúng sang trước khi xoá';
const INITIAL_STATUS_IN_USE_MESSAGE =
  'Đây là trạng thái ban đầu của quy trình đang được tổ chức hoặc dự án dùng — hãy đặt trạng thái ban đầu khác hoặc chọn quy trình khác ở đó trước khi xoá';
const REPLACEMENT_INVALID = 'Trạng thái thay thế phải là một trạng thái khác của cùng quy trình';

@Injectable()
export class WorkflowAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly resolver?: WorkflowResolver,
  ) {}

  // ----- Workflows -----

  /**
   * Điều kiện Workflow người xem được đọc: quy trình chung (không gắn dự án) + quy trình của dự án người đó thấy.
   * `visible` = `ProjectAccessService.visibleWhere` (`{}` = thấy hết → không thêm điều kiện).
   */
  private readableWhere(visible: Prisma.ProjectWhereInput): Prisma.WorkflowWhereInput {
    return Object.keys(visible).length ? { OR: [{ projectId: null }, { project: visible }] } : {};
  }

  /** `viewerId` bắt buộc: quy trình của dự án riêng tư người xem không thấy bị loại; `usedBy` chỉ gồm dự án thấy được. */
  async listWorkflows(
    workspaceId: string,
    filter: ListWorkflowsFilter,
    viewerId: string,
  ): Promise<WorkflowDto[]> {
    const visible = await this.access.visibleWhere(viewerId, workspaceId);
    const where: Prisma.WorkflowWhereInput = { workspaceId, ...this.readableWhere(visible) };
    // Mẫu (projectId = null) không bị ảnh hưởng; quy trình của dự án trong thùng rác ẩn đi, khôi phục dự án thì hiện lại.
    if (!filter.includeTrashed)
      where.AND = [{ OR: [{ projectId: null }, { project: { deletedAt: null } }] }];
    if (filter.projectId !== undefined) where.projectId = filter.projectId;
    if (filter.isTemplate !== undefined) where.isTemplate = filter.isTemplate;
    const rows = await this.prisma.workflow.findMany({
      where,
      include: workflowInclude,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    const usedBy = await this.usedByMap(
      workspaceId,
      rows.map((r) => r.id),
      visible,
    );
    return rows.map((r) => this.toWorkflowDto(r, usedBy.get(r.id)));
  }

  /**
   * Gom dự án đang dùng từng quy trình (ProjectDto không có defaultWorkflowId nên FE không tự ghép được): MỘT truy vấn
   * lấy dự án người xem thấy + MỘT groupBy đếm dự án không thấy (`hidden`). `visible` = `{}` → thấy hết, `hidden` rỗng.
   */
  private async usedByMap(
    workspaceId: string,
    workflowIds: string[],
    visible: Prisma.ProjectWhereInput,
  ): Promise<Map<string, UsedBy>> {
    const map = new Map<string, UsedBy>();
    if (workflowIds.length === 0) return map;
    const entry = (id: string): UsedBy => {
      let e = map.get(id);
      if (!e) map.set(id, (e = { usage: emptyUsage(), hiddenCount: 0 }));
      return e;
    };
    // allow-deleted: liệt kê cả dự án đã xoá mềm vì chúng vẫn giữ tham chiếu
    const projects = await this.prisma.project.findMany({
      where: { workspaceId, defaultWorkflowId: { in: workflowIds }, ...visible },
      select: { id: true, key: true, name: true, defaultWorkflowId: true, deletedAt: true },
      orderBy: { key: 'asc' },
    });
    for (const p of projects) {
      if (!p.defaultWorkflowId) continue;
      entry(p.defaultWorkflowId).usage.projects.push({
        id: p.id,
        key: p.key,
        name: p.name,
        deleted: p.deletedAt !== null,
      });
    }
    if (Object.keys(visible).length) {
      // allow-deleted: dự án đã xoá mềm (riêng tư) vẫn giữ tham chiếu nên vẫn chặn xoá quy trình
      const hidden = await this.prisma.project.groupBy({
        by: ['defaultWorkflowId'],
        where: { workspaceId, defaultWorkflowId: { in: workflowIds }, NOT: visible },
        _count: { _all: true },
      });
      for (const h of hidden) {
        if (h.defaultWorkflowId) entry(h.defaultWorkflowId).hiddenCount = h._count._all;
      }
    }
    await this.addSchemeUsage(workspaceId, workflowIds, visible, entry);
    return map;
  }

  /** Loại việc của tổ chức + ghi đè của dự án đang trỏ vào các quy trình `workflowIds`. */
  private async addSchemeUsage(
    workspaceId: string,
    workflowIds: string[],
    visible: Prisma.ProjectWhereInput,
    entry: (id: string) => UsedBy,
  ): Promise<void> {
    const typeKey = (t: { key: string | null; name: string }) => t.key ?? t.name;
    const scheme = await this.prisma.workspaceWorkflowScheme.findMany({
      where: { workspaceId, workflowId: { in: workflowIds } },
      select: { workflowId: true, issueType: { select: { key: true, name: true } } },
      orderBy: { issueType: { hierarchyLevel: 'desc' } },
    });
    for (const s of scheme) entry(s.workflowId).usage.scheme.push(typeKey(s.issueType));
    const overrides = await this.prisma.projectWorkflowOverride.findMany({
      where: { workflowId: { in: workflowIds }, project: { workspaceId, ...visible } },
      select: {
        workflowId: true,
        project: { select: { key: true } },
        issueType: { select: { key: true, name: true } },
      },
      orderBy: { project: { key: 'asc' } },
    });
    for (const o of overrides)
      entry(o.workflowId).usage.overrides.push({
        projectKey: o.project.key,
        typeKey: typeKey(o.issueType),
      });
    if (Object.keys(visible).length === 0) return;
    const hidden = await this.prisma.projectWorkflowOverride.groupBy({
      by: ['workflowId'],
      where: { workflowId: { in: workflowIds }, project: { workspaceId, NOT: visible } },
      _count: { _all: true },
    });
    for (const h of hidden) entry(h.workflowId).usage.hiddenOverrideCount = h._count._all;
  }

  /** Quy trình của dự án riêng tư người xem không thấy = không tồn tại (404 như id sai). */
  async getWorkflow(workspaceId: string, id: string, viewerId: string): Promise<WorkflowDto> {
    const visible = await this.access.visibleWhere(viewerId, workspaceId);
    const row = await this.prisma.workflow.findFirst({
      where: { id, workspaceId, ...this.readableWhere(visible) },
      include: workflowInclude,
    });
    if (!row) throw new NotFoundAppException('Quy trình');
    const usedBy = await this.usedByMap(workspaceId, [row.id], visible);
    return this.toWorkflowDto(row, usedBy.get(row.id));
  }

  async createWorkflow(workspaceId: string, input: CreateWorkflowInput): Promise<WorkflowDto> {
    if (input.projectId) {
      await this.requireProject(workspaceId, input.projectId);
    }
    await assertProjectIdWritable(this.prisma, input.projectId);
    try {
      const row = await this.prisma.workflow.create({
        data: {
          workspaceId,
          name: input.name,
          description: input.description ?? null,
          projectId: input.projectId ?? null,
          isTemplate: input.isTemplate ?? false,
        },
        include: workflowInclude,
      });
      return this.toWorkflowDto(row);
    } catch (e) {
      throw this.mapWorkflowError(e);
    }
  }

  async updateWorkflow(
    workspaceId: string,
    id: string,
    input: UpdateWorkflowInput,
  ): Promise<WorkflowDto> {
    const existing = await this.requireWorkflow(workspaceId, id);
    await assertProjectIdWritable(this.prisma, existing.projectId);

    const data: Prisma.WorkflowUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // isDefault chỉ duy nhất trong phạm vi (workspace, project) của workflow.
        if (input.isDefault === true) {
          await tx.workflow.updateMany({
            where: {
              workspaceId,
              projectId: existing.projectId,
              isDefault: true,
              id: { not: id },
            },
            data: { isDefault: false },
          });
        }
        return tx.workflow.update({
          where: { id },
          data,
          include: workflowInclude,
        });
      });
      // Chỉ Quản trị workspace gọi được (thấy mọi dự án) → không lọc usedBy.
      const usedBy = await this.usedByMap(workspaceId, [row.id], {});
      return this.toWorkflowDto(row, usedBy.get(row.id));
    } catch (e) {
      throw this.mapWorkflowError(e);
    }
  }

  async removeWorkflow(workspaceId: string, id: string): Promise<{ success: true }> {
    const existing = await this.requireWorkflow(workspaceId, id);
    await assertProjectIdWritable(this.prisma, existing.projectId);
    await this.assertNotInScheme(workspaceId, id);
    // Project.defaultWorkflowId là String? (không phải FK) nên xóa sẽ không tự
    // báo P2003 — phải tự kiểm tra tham chiếu.
    // allow-deleted: dự án đã xoá mềm vẫn giữ tham chiếu defaultWorkflowId
    const usedByProjects = await this.prisma.project.findMany({
      where: { workspaceId, defaultWorkflowId: id },
      select: { key: true },
      orderBy: { key: 'asc' },
    });
    if (usedByProjects.length > 0)
      throw new BusinessRuleException(workflowInUse(usedByProjects.map((p) => p.key)));
    try {
      await this.prisma.workflow.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new BusinessRuleException('Quy trình đang được dùng ở nơi khác — không xoá được');
      }
      // FK `onDelete: Restrict` của bảng gán loại việc/ghi đè: Postgres báo 23001 (không phải 23503) nên Prisma không map ra
      // P2003. Chỉ xảy ra khi có người vừa gán quy trình giữa lúc kiểm tra và lúc xoá.
      if (
        e instanceof Prisma.PrismaClientUnknownRequestError &&
        /23001|violates RESTRICT/.test(e.message)
      ) {
        throw new ConflictAppException(
          ERROR_CODES.WORKFLOW_IN_USE,
          'Quy trình vừa được gán cho một loại việc hoặc dự án — hãy tải lại rồi thử lại',
        );
      }
      throw e;
    }
    return { success: true };
  }

  /**
   * 409 WORKFLOW_IN_USE khi quy trình còn được gán cho một loại việc của tổ chức hoặc là ghi đè của một dự án (FK Restrict
   * cũng chặn, nhưng chỉ báo "đang dùng ở nơi khác" mà không nói ở đâu).
   */
  private async assertNotInScheme(workspaceId: string, workflowId: string): Promise<void> {
    const [scheme, overrides] = await Promise.all([
      this.prisma.workspaceWorkflowScheme.findMany({
        where: { workspaceId, workflowId },
        select: { issueType: { select: { key: true, name: true } } },
      }),
      this.prisma.projectWorkflowOverride.findMany({
        where: { workflowId, project: { workspaceId } },
        select: {
          project: { select: { key: true } },
          issueType: { select: { key: true, name: true } },
        },
      }),
    ]);
    if (scheme.length === 0 && overrides.length === 0) return;
    const parts = [
      ...(scheme.length
        ? [
            `loại việc ${scheme.map((s) => s.issueType.key ?? s.issueType.name).join(', ')} của tổ chức`,
          ]
        : []),
      ...(overrides.length
        ? [`ghi đè của dự án ${[...new Set(overrides.map((o) => o.project.key))].join(', ')}`]
        : []),
    ];
    throw new ConflictAppException(
      ERROR_CODES.WORKFLOW_IN_USE,
      `Quy trình đang được dùng cho ${parts.join(' và ')} — hãy chọn quy trình khác ở đó trước khi xoá`,
    );
  }

  // ----- Statuses -----

  async createStatus(
    workspaceId: string,
    workflowId: string,
    input: CreateStatusInput,
  ): Promise<StatusDto> {
    const wf = await this.requireWorkflow(workspaceId, workflowId);
    await assertProjectIdWritable(this.prisma, wf.projectId);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isInitial === true) {
          await tx.status.updateMany({
            where: { workflowId, isInitial: true },
            data: { isInitial: false },
          });
        }
        return tx.status.create({
          data: {
            workflowId,
            name: input.name,
            category: input.category,
            color: input.color ?? null,
            order: input.order ?? 0,
            isInitial: input.isInitial ?? false,
          },
        });
      });
      return this.toStatusDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(STATUS_DUPLICATE);
      }
      throw e;
    }
  }

  async updateStatus(
    workspaceId: string,
    statusId: string,
    input: UpdateStatusInput,
  ): Promise<StatusDto> {
    const existing = await this.requireStatus(workspaceId, statusId);
    await assertProjectIdWritable(this.prisma, existing.projectId);

    const data: Prisma.StatusUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.category !== undefined) data.category = input.category;
    if (input.color !== undefined) data.color = input.color;
    if (input.order !== undefined) data.order = input.order;
    if (input.isInitial !== undefined) data.isInitial = input.isInitial;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isInitial === true) {
          await tx.status.updateMany({
            where: {
              workflowId: existing.workflowId,
              isInitial: true,
              id: { not: statusId },
            },
            data: { isInitial: false },
          });
        }
        return tx.status.update({ where: { id: statusId }, data });
      });
      return this.toStatusDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(STATUS_DUPLICATE);
      }
      throw e;
    }
  }

  /**
   * Xoá trạng thái. Còn việc (kể cả trong thùng rác) đang ở đó thì BẮT BUỘC `replacementStatusId` (trạng thái khác của cùng
   * quy trình): không có → 409 STATUS_HAS_ISSUES; có → chuyển hết việc sang đó (tăng version + lịch sử STATUS) rồi xoá,
   * cùng một transaction.
   */
  async removeStatus(
    workspaceId: string,
    actorId: string,
    statusId: string,
    replacementStatusId?: string,
  ): Promise<{ success: true; moved: number }> {
    const existing = await this.requireStatus(workspaceId, statusId);
    await assertProjectIdWritable(this.prisma, existing.projectId);
    if (existing.isInitial) await this.assertInitialNotInUse(workspaceId, existing.workflowId);
    // allow-deleted: issue đã xoá mềm vẫn giữ FK statusId nên vẫn chặn xoá trạng thái
    const usedByIssues = await this.prisma.issue.count({
      where: { statusId },
    });
    if (usedByIssues > 0 && !replacementStatusId)
      throw new ConflictAppException(ERROR_CODES.STATUS_HAS_ISSUES, STATUS_HAS_ISSUES_MESSAGE);
    let affected: AffectedRuleDto[] = [];
    try {
      const moved = await this.prisma.$transaction(
        async (tx) => {
          await lockWorkspaceWorkflows(tx, workspaceId);
          let count = 0;
          if (usedByIssues > 0) {
            const [from, to] = await Promise.all([
              tx.status.findUniqueOrThrow({
                where: { id: statusId },
                select: { id: true, name: true, category: true },
              }),
              replacementStatusId && replacementStatusId !== statusId
                ? tx.status.findFirst({
                    where: { id: replacementStatusId, workflowId: existing.workflowId },
                    select: { id: true, name: true, category: true },
                  })
                : null,
            ]);
            if (!to) throw new BusinessRuleException(REPLACEMENT_INVALID);
            const resolution = await tx.resolution.findFirst({
              where: { workspaceId, isDefault: true },
              select: { id: true },
            });
            ({ count } = await moveIssuesToStatus(tx, {
              where: { workspaceId },
              from,
              to,
              actorId,
              historyActorId: await systemActorId(tx),
              defaultResolutionId: resolution?.id ?? null,
            }));
          }
          // Quy tắc automation nhắc tới trạng thái này: sang trạng thái thay thế; không có thay thế → tắt quy tắc + báo người tạo.
          ({ affectedRules: affected } = await rewriteRuleStatusRefs(
            tx,
            workspaceId,
            new Map([
              [
                statusId,
                replacementStatusId && replacementStatusId !== statusId
                  ? [replacementStatusId]
                  : [],
              ],
            ]),
            { dryRun: false, projectScope: existing.projectId ?? undefined },
          ));
          await tx.status.delete({ where: { id: statusId } });
          return count;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
      this.resolver?.invalidate();
      await publishRuleChanges(
        { events: this.events, notifications: this.notifications },
        workspaceId,
        actorId,
        affected,
      );
      return { success: true, moved };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictAppException(ERROR_CODES.STATUS_HAS_ISSUES, STATUS_HAS_ISSUES_MESSAGE);
      }
      throw e;
    }
  }

  /**
   * Trạng thái ban đầu là nơi việc mới được tạo vào: xoá nó khi quy trình còn được loại việc của tổ chức hoặc ghi đè dự án dùng
   * thì việc mới sẽ không có chỗ vào → 409 INITIAL_STATUS_IN_USE (hãy đặt trạng thái ban đầu khác trước).
   */
  private async assertInitialNotInUse(workspaceId: string, workflowId: string): Promise<void> {
    const [scheme, overrides] = await Promise.all([
      this.prisma.workspaceWorkflowScheme.count({ where: { workspaceId, workflowId } }),
      this.prisma.projectWorkflowOverride.count({
        where: { workflowId, project: { workspaceId } },
      }),
    ]);
    if (scheme + overrides > 0)
      throw new ConflictAppException(
        ERROR_CODES.INITIAL_STATUS_IN_USE,
        INITIAL_STATUS_IN_USE_MESSAGE,
      );
  }

  /**
   * Dự án SỞ HỮU một quy trình / trạng thái / bước chuyển (null = quy trình chung của tổ chức). Controller dùng để quyết định ai
   * được sửa: quy trình của dự án do Quản trị dự án đó (PermissionsGuard đã kiểm `project:admin` tại dự án), quy trình chung chỉ
   * Quản trị chung. Không thuộc tổ chức này → 404.
   */
  async ownerProjectId(
    workspaceId: string,
    kind: 'workflow' | 'status' | 'transition',
    id: string,
  ): Promise<string | null> {
    if (kind === 'workflow') return (await this.requireWorkflow(workspaceId, id)).projectId;
    if (kind === 'status') return (await this.requireStatus(workspaceId, id)).projectId;
    return (await this.requireTransition(workspaceId, id)).projectId;
  }

  // ----- Transitions -----

  async createTransition(
    workspaceId: string,
    workflowId: string,
    input: CreateTransitionInput,
  ): Promise<TransitionDto> {
    const wf = await this.requireWorkflow(workspaceId, workflowId);
    await assertProjectIdWritable(this.prisma, wf.projectId);
    await this.assertStatusInWorkflow(workflowId, input.toStatusId, 'toStatusId');
    if (input.fromStatusId) {
      await this.assertStatusInWorkflow(workflowId, input.fromStatusId, 'fromStatusId');
    }
    const row = await this.prisma.workflowTransition.create({
      data: {
        workflowId,
        name: input.name,
        fromStatusId: input.fromStatusId ?? null,
        toStatusId: input.toStatusId,
        order: input.order ?? 0,
      },
    });
    return this.toTransitionDto(row);
  }

  async updateTransition(
    workspaceId: string,
    transitionId: string,
    input: UpdateTransitionInput,
  ): Promise<TransitionDto> {
    const existing = await this.requireTransition(workspaceId, transitionId);
    await assertProjectIdWritable(this.prisma, existing.projectId);

    const data: Prisma.WorkflowTransitionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.order !== undefined) data.order = input.order;
    if (input.toStatusId !== undefined) {
      await this.assertStatusInWorkflow(existing.workflowId, input.toStatusId, 'toStatusId');
      data.toStatus = { connect: { id: input.toStatusId } };
    }
    if (input.fromStatusId !== undefined) {
      if (input.fromStatusId === null) {
        data.fromStatus = { disconnect: true };
      } else {
        await this.assertStatusInWorkflow(existing.workflowId, input.fromStatusId, 'fromStatusId');
        data.fromStatus = { connect: { id: input.fromStatusId } };
      }
    }

    const row = await this.prisma.workflowTransition.update({
      where: { id: transitionId },
      data,
    });
    return this.toTransitionDto(row);
  }

  async removeTransition(workspaceId: string, transitionId: string): Promise<{ success: true }> {
    const existing = await this.requireTransition(workspaceId, transitionId);
    await assertProjectIdWritable(this.prisma, existing.projectId);
    await this.prisma.workflowTransition.delete({ where: { id: transitionId } });
    return { success: true };
  }

  // ----- Helpers -----

  private async requireProject(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    return project;
  }

  private async requireWorkflow(
    workspaceId: string,
    id: string,
  ): Promise<{ id: string; workspaceId: string; projectId: string | null }> {
    const wf = await this.prisma.workflow.findFirst({
      where: { id, workspaceId },
      select: { id: true, workspaceId: true, projectId: true },
    });
    if (!wf) throw new NotFoundAppException('Quy trình');
    return wf;
  }

  private async requireStatus(
    workspaceId: string,
    statusId: string,
  ): Promise<{ id: string; workflowId: string; projectId: string | null; isInitial: boolean }> {
    const status = await this.prisma.status.findFirst({
      where: { id: statusId, workflow: { workspaceId } },
      select: {
        id: true,
        workflowId: true,
        isInitial: true,
        workflow: { select: { projectId: true } },
      },
    });
    if (!status) throw new NotFoundAppException('Trạng thái');
    return {
      id: status.id,
      workflowId: status.workflowId,
      isInitial: status.isInitial,
      projectId: status.workflow.projectId,
    };
  }

  private async requireTransition(
    workspaceId: string,
    transitionId: string,
  ): Promise<{ id: string; workflowId: string; projectId: string | null }> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id: transitionId, workflow: { workspaceId } },
      select: { id: true, workflowId: true, workflow: { select: { projectId: true } } },
    });
    if (!transition) throw new NotFoundAppException('Bước chuyển trạng thái');
    return {
      id: transition.id,
      workflowId: transition.workflowId,
      projectId: transition.workflow.projectId,
    };
  }

  /** Đảm bảo status thuộc đúng workflow (from/to phải cùng workflow). */
  private async assertStatusInWorkflow(
    workflowId: string,
    statusId: string,
    field: string,
  ): Promise<void> {
    const status = await this.prisma.status.findFirst({
      where: { id: statusId, workflowId },
      select: { id: true },
    });
    if (!status) {
      throw new BusinessRuleException('Trạng thái không thuộc quy trình này', [
        { field, code: 'STATUS_NOT_IN_WORKFLOW', message: 'Trạng thái không thuộc quy trình này' },
      ]);
    }
  }

  private mapWorkflowError(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BusinessRuleException(WORKFLOW_DUPLICATE);
    }
    return e;
  }

  private toWorkflowDto(
    row: WorkflowRow,
    used: UsedBy = { usage: emptyUsage(), hiddenCount: 0 },
  ): WorkflowDto {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      isTemplate: row.isTemplate,
      isDefault: row.isDefault,
      sourceTemplateId: row.sourceTemplateId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      statuses: row.statuses.map((s) => this.toStatusDto(s)),
      transitions: row.transitions.map((t) => this.toTransitionDto(t)),
      usedBy: used.usage,
      hiddenCount: used.hiddenCount,
    };
  }

  private toStatusDto(row: StatusRow): StatusDto {
    return {
      id: row.id,
      workflowId: row.workflowId,
      name: row.name,
      category: row.category,
      color: row.color,
      order: row.order,
      isInitial: row.isInitial,
    };
  }

  private toTransitionDto(row: TransitionRow): TransitionDto {
    return {
      id: row.id,
      workflowId: row.workflowId,
      name: row.name,
      fromStatusId: row.fromStatusId,
      toStatusId: row.toStatusId,
      order: row.order,
    };
  }
}
