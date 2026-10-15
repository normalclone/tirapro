import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DOMAIN_EVENTS,
  PERMISSIONS,
  type AutomationEventMeta,
  type BulkUpdateIssuesResult,
  type IssueDto,
  type IssueEnvironment,
} from '@tirapro/types';
import {
  issueTypePrefix,
  normalizeEnvironment,
  type BulkUpdateIssuesInput,
  type CreateIssueInput,
  type MoveIssueInput,
  type TransitionIssueInput,
  type UpdateIssueInput,
} from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toUserDto, USER_DTO_SELECT } from '../../common/mappers/user.mapper';
import { iso } from '../../common/mappers/date';
import { insensitiveContains } from '../../common/like';
import { assertIssueOwner } from '../rbac/issue-ownership.service';
import { RbacService } from '../rbac/rbac.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  InvalidTransitionException,
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { cursorPage, PageResult } from '../../common/dto/page-result';
import { assertNotArchived, assertProjectWritable } from '../../common/project-writable';
import { LIVE_PROJECT } from '../../common/live-project';
import { RankService } from './rank.service';
import { WipService } from './wip.service';

const issueInclude = {
  type: true,
  status: true,
  priority: true,
  severity: true,
  resolution: true,
  assignee: { select: USER_DTO_SELECT },
  reporter: { select: USER_DTO_SELECT },
  labels: { include: { label: true } },
} satisfies Prisma.IssueInclude;

type IssueRow = Prisma.IssueGetPayload<{ include: typeof issueInclude }>;

/** Dòng issue kèm `project.archivedAt` — dùng cho mọi thao tác ghi để chặn dự án đã lưu trữ. */
const issueWriteInclude = {
  ...issueInclude,
  project: { select: { archivedAt: true } },
} satisfies Prisma.IssueInclude;
type IssueWriteRow = Prisma.IssueGetPayload<{ include: typeof issueWriteInclude }>;

/** Người báo tự thu hồi (xoá) công việc của mình trong khoảng này kể từ lúc tạo. */
export const RETRACT_WINDOW_MS = 10 * 60_000;

/** Trường issue mà `update()` có thể đổi — dùng để báo `changedFields` cho automation (trigger ISSUE_UPDATED). */
const TRACKED_FIELDS = [
  'summary',
  'description',
  'priorityId',
  'severityId',
  'assigneeId',
  'storyPoints',
  'sprintId',
  'resolutionId',
  'typeId',
  'dueDate',
  'startDate',
  'parentId',
  'epicId',
  'originalEstimate',
  'remainingEstimate',
] as const;

function changedFieldsOf(before: IssueRow, after: IssueRow): string[] {
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  return TRACKED_FIELDS.filter((f) => !same(before[f], after[f]));
}

/** Lô tối đa 100 issue × ~4 truy vấn tuần tự: mặc định 5s của interactive transaction quá sát, quá hạn là rollback cả lô. */
const BULK_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

/** `meta` chỉ gắn vào payload khi do automation gây ra — sự kiện của người dùng thật giữ nguyên hình dạng cũ. */
const withMeta = (meta: AutomationEventMeta | undefined) => (meta ? { meta } : {});

/**
 * Issue của dự án đã xoá mềm là "không tồn tại" với mọi truy vấn đọc cấp workspace (getByKey/list/search).
 * Lọc lúc đọc (join `project.deletedAt`) thay vì xoá mềm dây chuyền issue khi xoá dự án.
 */

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
    // Mặc định dựng từ CÙNG prisma/events/rbac để chỗ dựng service bằng 3 đối số (spec cũ) chạy y như trước; Nest DI tiêm bản thật.
    private readonly rankService: RankService = new RankService(prisma, events),
    private readonly wipService: WipService = new WipService(prisma, rbac),
  ) {}

  /**
   * Story points, Hạn & Ngày bắt đầu (một luật "ai đổi lịch/ước lượng") chỉ người TẠO/BÁO CÁO issue hoặc
   * QUẢN TRỊ (project admin / workspace admin / system admin) được sửa. Ném lỗi nếu vi phạm.
   */
  private async assertCanEditRestrictedFields(
    userId: string,
    workspaceId: string,
    issue: { reporterId: string | null; createdById: string | null; projectId: string },
  ): Promise<void> {
    if (issue.reporterId === userId || issue.createdById === userId) return;
    const perms = await this.rbac.getEffectivePermissions(userId, workspaceId, issue.projectId);
    if (perms.has(PERMISSIONS.PROJECT_ADMIN) || perms.has(PERMISSIONS.WORKSPACE_ADMIN)) return;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true },
    });
    if (u?.isSystemAdmin) return;
    throw new ForbiddenAppException(
      'Chỉ người tạo hoặc quản trị mới được sửa Story points/Hạn/Ngày bắt đầu',
    );
  }

  /** Bắt đầu phải trước hoặc bằng hạn — chỉ kiểm khi cả hai có giá trị (xoá một trong hai luôn được). */
  private assertScheduleOrder(
    start: Date | string | null | undefined,
    due: Date | string | null | undefined,
  ): void {
    if (!start || !due) return;
    if (new Date(start).getTime() > new Date(due).getTime()) {
      throw new BusinessRuleException('Ngày bắt đầu phải trước hoặc bằng hạn — hãy chọn lại ngày');
    }
  }

  /** Người chỉ có `issue:edit:own` chỉ sửa được việc mình báo cáo, được giao hoặc đã tạo. */
  private assertOwnsIssue(
    userId: string,
    issue: { reporterId: string | null; assigneeId: string | null; createdById: string | null },
  ): void {
    assertIssueOwner(userId, issue);
  }

  /**
   * Cùng quy ước với PermissionsGuard: có `issue:transition` hoặc system admin → `ownOnly:false`;
   * chỉ có `issue:transition:own` → `ownOnly:true` (người gọi phải kiểm sở hữu từng issue); còn lại 403.
   */
  private async assertCanTransition(
    userId: string,
    workspaceId: string,
    projectId: string,
  ): Promise<{ ownOnly: boolean }> {
    const perms = await this.rbac.getEffectivePermissions(userId, workspaceId, projectId);
    if (perms.has(PERMISSIONS.ISSUE_TRANSITION)) return { ownOnly: false };
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true },
    });
    if (u?.isSystemAdmin) return { ownOnly: false };
    if (perms.has(`${PERMISSIONS.ISSUE_TRANSITION}:own`)) return { ownOnly: true };
    throw new ForbiddenAppException(
      'Bạn không có quyền chuyển trạng thái công việc — hãy bỏ phần đổi trạng thái hoặc nhờ quản trị cấp quyền',
    );
  }

  /** Priority mặc định của workspace (undefined nếu chưa cấu hình). */
  private async defaultPriorityId(
    db: Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<string | undefined> {
    const def = await db.priority.findFirst({
      where: { workspaceId, isDefault: true },
      select: { id: true },
    });
    return def?.id;
  }

  /** Đảm bảo metadata/quan hệ (nếu truyền) thuộc đúng workspace — chống gán/liên kết chéo tenant. */
  private async assertMetaInWorkspace(
    workspaceId: string,
    m: {
      typeId?: string | null;
      priorityId?: string | null;
      severityId?: string | null;
      sprintId?: string | null;
      /** Import (Jira) tạo sprint CLOSED theo lịch sử rồi gắn issue vào — chỉ đường `createWithin` bật cờ này. */
      allowClosedSprint?: boolean;
      resolutionId?: string | null;
      parentId?: string | null;
      /** Dự án của issue/lô: có thì `sprintId` phải thuộc CHÍNH dự án này (không chỉ cùng workspace). */
      projectId?: string;
    },
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const jobs: Array<Promise<{ id: string; state?: string } | null>> = [];
    if (m.typeId)
      jobs.push(
        db.issueType.findFirst({ where: { id: m.typeId, workspaceId }, select: { id: true } }),
      );
    if (m.priorityId)
      jobs.push(
        db.priority.findFirst({ where: { id: m.priorityId, workspaceId }, select: { id: true } }),
      );
    if (m.severityId)
      jobs.push(
        db.severity.findFirst({ where: { id: m.severityId, workspaceId }, select: { id: true } }),
      );
    if (m.resolutionId)
      jobs.push(
        db.resolution.findFirst({
          where: { id: m.resolutionId, workspaceId },
          select: { id: true },
        }),
      );
    if (m.sprintId)
      jobs.push(
        db.sprint.findFirst({
          where: {
            id: m.sprintId,
            deletedAt: null,
            project: { workspaceId, deletedAt: null },
            ...(m.projectId ? { projectId: m.projectId } : {}),
          },
          select: { id: true, state: true },
        }),
      );
    if (m.parentId)
      jobs.push(
        db.issue.findFirst({
          where: { id: m.parentId, workspaceId, deletedAt: null },
          select: { id: true },
        }),
      );
    if (!jobs.length) return;
    const found = await Promise.all(jobs);
    if (found.some((r) => r == null)) {
      throw new NotFoundAppException(
        'Loại công việc, độ ưu tiên, sprint (phải cùng dự án), kết quả xử lý, việc cha hoặc epic bạn chọn không thuộc không gian làm việc này — hãy chọn lại từ danh sách gợi ý',
      );
    }
    // Sprint đã hoàn thành không nhận thêm việc (bỏ gán/giữ nguyên thì không đi qua đây — xem `sprintIfChanged`).
    if (!m.allowClosedSprint && found.some((r) => r?.state === 'CLOSED')) {
      throw new BusinessRuleException(
        'Sprint đã hoàn thành — không thêm việc vào được nữa. Hãy chọn sprint khác hoặc để việc ở Backlog',
      );
    }
  }

  /**
   * Chỉ kiểm sprint khi thật sự ĐỔI: việc đang nằm trong sprint đã đóng mà client gửi lại đúng `sprintId` cũ
   * (hoặc không đụng tới) thì không bị chặn; `null` (bỏ gán) cũng không cần kiểm.
   */
  private sprintIfChanged(
    next: string | null | undefined,
    current: string | null,
  ): string | null | undefined {
    return next === undefined || next === current ? undefined : next;
  }

  /**
   * Quyền phụ của `move()` ngoài `issue:transition` (đã kiểm ở guard):
   * - đổi `sprintId` cần `issue:edit` (`issue:edit:own` chỉ với việc của mình, như PATCH) hoặc system admin → else 403;
   * - mốc rank (`afterId`/`beforeId`) cần `issue:edit` hoặc `backlog:manage` (hoặc system admin). Thiếu: nếu ĐANG đổi
   *   trạng thái thì BỎ QUA mốc (giữ rank, vẫn chuyển) — trả `false`; không đổi trạng thái thì 403.
   * Trả `true` khi mốc rank được dùng. Không đụng DB quyền nếu request không có sprint/mốc.
   */
  private async assertMoveCapabilities(
    workspaceId: string,
    userId: string,
    current: {
      projectId: string;
      reporterId: string | null;
      assigneeId: string | null;
      createdById: string | null;
    },
    want: { sprintChanged: boolean; wantsRank: boolean; statusChanged: boolean },
  ): Promise<boolean> {
    if (!want.sprintChanged && !want.wantsRank) return true;
    const perms = await this.rbac.getEffectivePermissions(userId, workspaceId, current.projectId);
    let admin: boolean | undefined;
    const isAdmin = async () =>
      (admin ??= !!(
        await this.prisma.user.findUnique({
          where: { id: userId },
          select: { isSystemAdmin: true },
        })
      )?.isSystemAdmin);
    const canEdit = perms.has(PERMISSIONS.ISSUE_EDIT);

    if (want.sprintChanged && !canEdit && !(await isAdmin())) {
      if (perms.has(`${PERMISSIONS.ISSUE_EDIT}:own`)) this.assertOwnsIssue(userId, current);
      else
        throw new ForbiddenAppException(
          'Bạn không có quyền đổi sprint của công việc — cần quyền sửa công việc hoặc nhờ quản trị cấp quyền',
        );
    }
    if (!want.wantsRank) return true;
    if (canEdit || perms.has(PERMISSIONS.BACKLOG_MANAGE) || (await isAdmin())) return true;
    if (want.statusChanged) return false;
    throw new ForbiddenAppException(
      'Bạn không có quyền sắp xếp lại thứ tự công việc — cần quyền sửa công việc hoặc quản lý backlog',
    );
  }

  /**
   * Epic của issue: phải tồn tại trong workspace, CÙNG dự án, đúng loại Epic (`key = EPIC` hoặc `hierarchyLevel >= 1`;
   * bỏ qua kiểm LOẠI khi `checkType = false` — đường import),
   * không phải chính issue và không tạo vòng (epic đang trỏ ngược về issue này) — vi phạm: 404/422.
   */
  private async assertEpicValid(
    db: Prisma.TransactionClient,
    workspaceId: string,
    epicId: string,
    projectId: string,
    selfId: string | null,
    checkType = true,
  ): Promise<void> {
    if (selfId && epicId === selfId)
      throw new BusinessRuleException(
        'Một công việc không thể là epic của chính nó — hãy chọn một epic khác',
      );
    const epic = await db.issue.findFirst({
      where: { id: epicId, workspaceId, deletedAt: null },
      select: {
        projectId: true,
        epicId: true,
        type: { select: { key: true, hierarchyLevel: true } },
      },
    });
    if (!epic)
      throw new NotFoundAppException(
        'Epic bạn chọn không thuộc không gian làm việc này — hãy chọn lại từ danh sách gợi ý',
      );
    if (epic.projectId !== projectId)
      throw new BusinessRuleException(
        'Epic phải thuộc cùng dự án với công việc — hãy chọn epic khác',
      );
    if (checkType && epic.type.key !== 'EPIC' && epic.type.hierarchyLevel < 1)
      throw new BusinessRuleException(
        'Công việc được chọn không phải loại Epic — hãy chọn một Epic trong dự án',
      );
    // Vòng: chuỗi epic của epic được chọn quay về chính issue này.
    let cur = epic.epicId;
    for (let depth = 0; selfId && cur && depth < 50; depth++) {
      if (cur === selfId)
        throw new BusinessRuleException(
          'Không thể chọn epic này vì sẽ tạo vòng lặp (epic đó đang thuộc về công việc này)',
        );
      const next: { epicId: string | null } | null = await db.issue.findFirst({
        where: { id: cur, workspaceId, deletedAt: null },
        select: { epicId: true },
      });
      cur = next?.epicId ?? null;
    }
  }

  /** Có thể gán mới cho user này không: là thành viên workspace và tài khoản chưa bị vô hiệu hoá. */
  async isAssignableMember(
    workspaceId: string,
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const member = await db.workspaceMembership.findFirst({
      where: { workspaceId, userId, user: { status: { not: 'DEACTIVATED' } } },
      select: { userId: true },
    });
    return !!member;
  }

  /**
   * Gán MỚI: người được giao phải là thành viên workspace còn hoạt động — chặn gán user của tenant khác
   * hay tài khoản đã vô hiệu hoá. `null`/rỗng (bỏ gán) luôn hợp lệ. Chỉ gọi khi assignee thật sự đổi:
   * việc cũ còn giữ người đã rời workspace thì không được làm hỏng các sửa không liên quan.
   */
  private async assertAssigneeInWorkspace(
    workspaceId: string,
    assigneeId: string | null | undefined,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (!assigneeId) return;
    if (!(await this.isAssignableMember(workspaceId, assigneeId, db)))
      throw new BusinessRuleException(
        'Người được giao không thuộc không gian làm việc này — hãy chọn một thành viên khác',
      );
  }

  async create(
    workspaceId: string,
    userId: string,
    input: CreateIssueInput,
    opts?: AutomationEventMeta,
  ): Promise<IssueDto> {
    const dto = await this.createCore(null, workspaceId, userId, input, null, 'api');
    this.emitCreated(dto, userId, input.clientId, opts);
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
    return this.createCore(tx, workspaceId, userId, input, deferred, 'import');
  }

  emitCreated(dto: IssueDto, actorId: string, clientId?: string, meta?: AutomationEventMeta): void {
    this.events.emit(DOMAIN_EVENTS.ISSUE_CREATED, {
      issue: dto,
      actorId,
      clientId,
      ...withMeta(meta),
    });
  }

  private async createCore(
    outerTx: Prisma.TransactionClient | null,
    workspaceId: string,
    userId: string,
    input: CreateIssueInput,
    deferred: Array<() => void> | null = null,
    /**
     * `api` (mặc định, `create`): đường người dùng — đòi `issue:transition` khi chọn trạng thái ≠ khởi tạo, chặn sprint
     * đã hoàn thành, epic phải đúng LOẠI Epic. `import` (`createWithin`): dữ liệu nhập từ nguồn ngoài (Jira) đã được
     * người có quyền import duyệt — sprint CLOSED theo lịch sử và epic thuộc loại tuỳ chỉnh vẫn nhận (epic vẫn phải
     * cùng dự án, không tự trỏ).
     */
    origin: 'api' | 'import' = 'api',
  ): Promise<IssueDto> {
    const db: Prisma.TransactionClient = outerTx ?? this.prisma;
    const project = await db.project.findFirst({
      where: { id: input.projectId, workspaceId, deletedAt: null },
      select: {
        id: true,
        key: true,
        defaultWorkflowId: true,
        leadId: true,
        defaultAssigneeMode: true,
        archivedAt: true,
      },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    assertNotArchived(project.archivedAt);
    this.assertScheduleOrder(input.startDate, input.dueDate);
    await this.assertMetaInWorkspace(
      workspaceId,
      {
        typeId: input.typeId,
        priorityId: input.priorityId,
        severityId: input.severityId,
        sprintId: input.sprintId,
        parentId: input.parentId,
        projectId: project.id,
        allowClosedSprint: origin === 'import',
      },
      db,
    );
    if (input.epicId)
      await this.assertEpicValid(db, workspaceId, input.epicId, project.id, null, origin === 'api');
    await this.assertAssigneeInWorkspace(workspaceId, input.assigneeId, db);

    // Status: input (phải thuộc workflow của dự án) hoặc trạng thái initial của workflow project
    const workflowId = project.defaultWorkflowId ?? '';
    const initial = await db.status.findFirst({
      where: { workflowId, isInitial: true },
      select: { id: true },
    });
    let statusId = input.statusId;
    let isDone = false;
    if (statusId) {
      const chosen = await db.status.findFirst({
        where: { id: statusId, workflowId },
        select: { id: true, category: true },
      });
      if (!chosen)
        throw new BusinessRuleException(
          'Trạng thái không thuộc quy trình của dự án này — hãy chọn lại trạng thái từ danh sách',
        );
      // Tạo thẳng ở trạng thái khác trạng thái khởi tạo cũng là một lần "chuyển trạng thái" → cần cùng quyền.
      if (origin === 'api' && chosen.id !== initial?.id)
        await this.assertCanTransition(userId, workspaceId, project.id);
      isDone = chosen.category === 'DONE';
    } else {
      if (!initial)
        throw new BusinessRuleException('Project chưa cấu hình workflow/trạng thái khởi đầu');
      statusId = initial.id;
    }

    // Priority mặc định của workspace nếu không truyền
    const priorityId = input.priorityId || (await this.defaultPriorityId(db, workspaceId));

    const assigneeId =
      input.assigneeId ?? (project.defaultAssigneeMode === 'PROJECT_LEAD' ? project.leadId : null);

    // Rank: cuối danh sách trong project
    const rank = await this.rankService.resolveRank(project.id, db, deferred, null, async () => {
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
      const typeSeq =
        // allow-deleted: đếm cả issue đã xoá để số thứ tự theo loại không sinh trùng key
        (await tx.issue.count({ where: { projectId: project.id, typeId: input.typeId } })) + 1;
      const key = `${project.key}-${issueTypePrefix(type?.key ?? null, type?.name ?? '')}-${typeSeq}`;
      const created = await tx.issue.create({
        data: {
          workspaceId,
          projectId: project.id,
          number,
          key,
          typeId: input.typeId,
          statusId,
          resolvedAt: isDone ? new Date() : null,
          priorityId: priorityId ?? null,
          severityId: input.severityId ?? null,
          environment: normalizeEnvironment(input.environment) ?? Prisma.DbNull,
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
        const valid = await tx.label.findMany({
          where: { id: { in: ids }, projectId: project.id },
          select: { id: true },
        });
        if (valid.length !== ids.length)
          throw new NotFoundAppException('Nhãn không thuộc dự án này');
        await tx.issueLabel.createMany({
          data: ids.map((labelId) => ({ issueId: created.id, labelId })),
          skipDuplicates: true,
        });
      }
      // History: trạng thái khởi tạo
      await tx.issueHistory.create({
        data: {
          issueId: created.id,
          projectId: project.id,
          sprintId: created.sprintId,
          field: 'STATUS',
          newValue: created.status.name,
          newCategory: created.status.category,
          actorId: userId,
          occurredAt: new Date(),
        },
      });
      return created;
    };
    const issue = outerTx ? await body(outerTx) : await this.prisma.$transaction(body);
    return this.toDto(issue);
  }

  async list(
    workspaceId: string,
    filter: IssueListFilter,
    cursor: string | undefined,
    limit: number,
  ): Promise<PageResult<IssueDto>> {
    const where: Prisma.IssueWhereInput = {
      workspaceId,
      deletedAt: null,
      ...LIVE_PROJECT,
      projectId: filter.projectId,
      statusId: filter.statusId,
      assigneeId: filter.assigneeId,
      typeId: filter.typeId,
      sprintId: filter.sprintId,
      ...(filter.search ? { summary: insensitiveContains(filter.search) } : {}),
    };
    const rows = await this.prisma.issue.findMany({
      where,
      include: issueInclude,
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return cursorPage(
      rows.map((r) => this.toDto(r)),
      limit,
      (i) => i.id,
    );
  }

  /**
   * Truy vấn theo where đã biên dịch (vd từ JQL/Search). Tự ghép workspace + soft-delete.
   * `rawIds` (kết quả full-text, đã xếp theo rank): chỉ lấy các id đó và — khi không có `orderBy` —
   * giữ đúng thứ tự rank (tối đa vài trăm id nên sắp xếp/phân trang trong bộ nhớ).
   * `rankHint` (id đã xếp hạng, KHÔNG giới hạn tập kết quả): khi không có `orderBy`, các id này
   * khớp `where` lên trước theo thứ tự rank, phần còn lại khớp `where` theo `updatedAt` giảm dần.
   */
  async query(
    workspaceId: string,
    where: Prisma.IssueWhereInput,
    orderBy: Prisma.IssueOrderByWithRelationInput[],
    cursor: string | undefined,
    limit: number,
    rawIds?: string[],
    rankHint?: string[],
  ): Promise<PageResult<IssueDto>> {
    const scope: Prisma.IssueWhereInput = {
      AND: [{ workspaceId, deletedAt: null, ...LIVE_PROJECT }, where],
    };
    if (rawIds) {
      if (rawIds.length === 0) return cursorPage<IssueDto>([], limit, (i) => i.id);
      const idScope: Prisma.IssueWhereInput = { AND: [scope, { id: { in: rawIds } }] };
      if (!orderBy.length) {
        const rows = await this.prisma.issue.findMany({ where: idScope, include: issueInclude });
        const position = new Map(rawIds.map((id, i) => [id, i]));
        const sorted = rows
          .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))
          .map((r) => this.toDto(r));
        // Con trỏ không còn trong danh sách (kết quả tìm đổi giữa hai lần gọi) → trang rỗng, KHÔNG quay về trang đầu
        // (client nạp tiếp tự động sẽ lặp vô hạn). Con trỏ còn trong rawIds nhưng issue đã biến mất vẫn tiếp tục đúng chỗ.
        const cursorPos = cursor ? (position.get(cursor) ?? -1) : -1;
        if (cursor && cursorPos < 0) return cursorPage<IssueDto>([], limit, (i) => i.id);
        const rest = cursor ? sorted.filter((i) => (position.get(i.id) ?? 0) > cursorPos) : sorted;
        return cursorPage(rest.slice(0, limit + 1), limit, (i) => i.id);
      }
      return this.queryOrdered(idScope, orderBy, cursor, limit);
    }
    if (rankHint?.length && !orderBy.length) {
      return this.queryRankFirst(scope, rankHint, cursor, limit);
    }
    return this.queryOrdered(scope, orderBy, cursor, limit);
  }

  /** Id trong `rank` (đã xếp hạng) lên trước theo đúng thứ tự, sau đó các việc khớp còn lại theo updatedAt giảm dần. */
  private async queryRankFirst(
    scope: Prisma.IssueWhereInput,
    rank: string[],
    cursor: string | undefined,
    limit: number,
  ): Promise<PageResult<IssueDto>> {
    const pos = new Map(rank.map((id, i) => [id, i]));
    const cursorRanked = cursor !== undefined && pos.has(cursor);
    const out: IssueDto[] = [];
    if (!cursor || cursorRanked) {
      // allow-deleted: scope do `query()` dựng sẵn (có `workspaceId, deletedAt: null`)
      const rows = await this.prisma.issue.findMany({
        where: { AND: [scope, { id: { in: rank } }] },
        include: issueInclude,
      });
      const sorted = rows.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!).map((r) => this.toDto(r));
      const after = cursorRanked ? pos.get(cursor)! : -1;
      out.push(...sorted.filter((i) => pos.get(i.id)! > after).slice(0, limit + 1));
    }
    if (out.length < limit + 1) {
      // allow-deleted: scope do `query()` dựng sẵn (có `workspaceId, deletedAt: null`)
      const rest = await this.prisma.issue.findMany({
        where: { AND: [scope, { id: { notIn: rank } }] },
        include: issueInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit + 1 - out.length,
        ...(cursor && !cursorRanked ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      out.push(...rest.map((r) => this.toDto(r)));
    }
    return cursorPage(out, limit, (i) => i.id);
  }

  private async queryOrdered(
    where: Prisma.IssueWhereInput,
    orderBy: Prisma.IssueOrderByWithRelationInput[],
    cursor: string | undefined,
    limit: number,
  ): Promise<PageResult<IssueDto>> {
    const finalOrder: Prisma.IssueOrderByWithRelationInput[] = orderBy.length
      ? [...orderBy, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'asc' }];
    // ORDER BY severity DESC: Postgres đặt NULL (chưa đặt mức) lên ĐẦU khi DESC và Prisma không cho `nulls` trên
    // quan hệ → tách hai pha (có mức rồi chưa đặt mức) để việc chưa đặt mức luôn xuống cuối.
    const first = finalOrder[0] as { severity?: { rank?: string } };
    if (first.severity?.rank === 'desc')
      return this.queryNullsLastBySeverity(where, finalOrder, cursor, limit);
    // allow-deleted: where do `query()` dựng sẵn (scope có `workspaceId, deletedAt: null`); queryOrdered chỉ nhận scope đó
    const rows = await this.prisma.issue.findMany({
      where,
      include: issueInclude,
      orderBy: finalOrder,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return cursorPage(
      rows.map((r) => this.toDto(r)),
      limit,
      (i) => i.id,
    );
  }

  /** Hai pha cho ORDER BY severity DESC: việc có mức (theo `orderBy`), rồi việc chưa đặt mức (cùng `orderBy`). Con trỏ = id. */
  private async queryNullsLastBySeverity(
    where: Prisma.IssueWhereInput,
    orderBy: Prisma.IssueOrderByWithRelationInput[],
    cursor: string | undefined,
    limit: number,
  ): Promise<PageResult<IssueDto>> {
    let cursorInUnset = false;
    if (cursor) {
      // allow-deleted: where do `query()` dựng sẵn (scope có `workspaceId, deletedAt: null`)
      const c = await this.prisma.issue.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { severityId: true },
      });
      if (!c) return cursorPage<IssueDto>([], limit, (i) => i.id);
      cursorInUnset = c.severityId === null;
    }
    const take = limit + 1;
    const rows: IssueRow[] = [];
    if (!cursorInUnset) {
      // allow-deleted: where do `query()` dựng sẵn (scope có `workspaceId, deletedAt: null`)
      const withSeverity = await this.prisma.issue.findMany({
        where: { AND: [where, { severityId: { not: null } }] },
        include: issueInclude,
        orderBy,
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      rows.push(...withSeverity);
    }
    if (rows.length < take) {
      // allow-deleted: where do `query()` dựng sẵn (scope có `workspaceId, deletedAt: null`)
      const unset = await this.prisma.issue.findMany({
        where: { AND: [where, { severityId: null }] },
        include: issueInclude,
        orderBy,
        take: take - rows.length,
        ...(cursor && cursorInUnset ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      rows.push(...unset);
    }
    return cursorPage(
      rows.map((r) => this.toDto(r)),
      limit,
      (i) => i.id,
    );
  }

  async getByKey(workspaceId: string, key: string): Promise<IssueDto> {
    const issue = await this.prisma.issue.findFirst({
      where: { workspaceId, key, deletedAt: null, ...LIVE_PROJECT },
      include: issueInclude,
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    return this.toDto(issue);
  }

  /**
   * `opts` do automation truyền vào (tầng/chuỗi quy tắc): gắn vào `meta` của sự kiện để engine chặn vòng lặp,
   * và bỏ qua kiểm tra "chỉ người tạo/quản trị sửa Story points/Hạn" (người dùng hệ thống không phải thành viên —
   * quy tắc đã do quản trị tạo).
   */
  async update(
    workspaceId: string,
    userId: string,
    id: string,
    input: UpdateIssueInput,
    opts?: AutomationEventMeta,
    ownOnly?: boolean,
  ): Promise<IssueDto> {
    const current = await this.requireIssue(workspaceId, id);
    if (ownOnly) this.assertOwnsIssue(userId, current);
    this.assertVersion(current.version, input.version);
    await this.assertMetaInWorkspace(workspaceId, {
      typeId: input.typeId,
      priorityId: input.priorityId,
      severityId: input.severityId,
      sprintId: this.sprintIfChanged(input.sprintId, current.sprintId),
      resolutionId: input.resolutionId,
      parentId: input.parentId,
      projectId: current.projectId,
    });
    if (input.epicId && input.epicId !== current.epicId)
      await this.assertEpicValid(this.prisma, workspaceId, input.epicId, current.projectId, id);
    if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId)
      await this.assertAssigneeInWorkspace(workspaceId, input.assigneeId);

    // Field-level: Story points / Hạn / Ngày bắt đầu chỉ người tạo hoặc admin sửa được.
    if (
      (input.storyPoints !== undefined ||
        input.dueDate !== undefined ||
        input.startDate !== undefined) &&
      opts?.automationDepth === undefined
    ) {
      await this.assertCanEditRestrictedFields(userId, workspaceId, current);
    }
    // Thứ tự ngày tính trên giá trị HIỆU LỰC sau khi sửa (trường không gửi giữ giá trị hiện có).
    this.assertScheduleOrder(
      input.startDate !== undefined ? input.startDate : current.startDate,
      input.dueDate !== undefined ? input.dueDate : current.dueDate,
    );

    const data: Prisma.IssueUncheckedUpdateManyInput = { updatedById: userId };
    if (input.summary !== undefined) data.summary = input.summary;
    if (input.description !== undefined) data.description = input.description;
    if (input.priorityId !== undefined) data.priorityId = input.priorityId ?? null;
    if (input.severityId !== undefined) data.severityId = input.severityId ?? null;
    if (input.environment !== undefined)
      data.environment = normalizeEnvironment(input.environment) ?? Prisma.DbNull;
    if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId ?? null;
    if (input.storyPoints !== undefined) data.storyPoints = input.storyPoints;
    if (input.sprintId !== undefined) data.sprintId = input.sprintId ?? null;
    if (input.resolutionId !== undefined) data.resolutionId = input.resolutionId ?? null;
    if (input.typeId !== undefined && input.typeId) data.typeId = input.typeId;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    if (input.startDate !== undefined)
      data.startDate = input.startDate ? new Date(input.startDate) : null;
    if (input.originalEstimate !== undefined)
      data.originalEstimate = input.originalEstimate ?? null;
    if (input.remainingEstimate !== undefined)
      data.remainingEstimate = input.remainingEstimate ?? null;
    if (input.epicId !== undefined) data.epicId = input.epicId ?? null;
    if (input.parentId !== undefined) {
      if (input.parentId === id)
        throw new BusinessRuleException(
          'Một công việc không thể là việc cha của chính nó — hãy chọn một công việc khác làm việc cha',
        );
      if (input.parentId) await this.assertNoParentCycle(workspaceId, id, input.parentId);
      data.parentId = input.parentId ?? null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.updateWithVersion(tx, id, workspaceId, input.version, data);
      await this.recordChanges(tx, userId, current, row);
      return row;
    });
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, {
      issue: dto,
      actorId: userId,
      changedFields: changedFieldsOf(current, updated),
      ...withMeta(opts),
    });
    return dto;
  }

  /**
   * Sửa hàng loạt MỘT lô issue của cùng dự án trong một transaction. Item bị người khác sửa trước
   * (version lệch) không làm hỏng cả lô: được thu vào `conflicts` kèm version hiện tại.
   * Item không thuộc dự án/không gian làm việc, hoặc chuyển trạng thái sai workflow → lỗi cho cả yêu cầu, chưa ghi gì.
   * Sự kiện chỉ phát sau khi commit.
   */
  async bulkUpdate(
    workspaceId: string,
    userId: string,
    input: BulkUpdateIssuesInput,
    ownOnly?: boolean,
  ): Promise<BulkUpdateIssuesResult> {
    const { projectId, items, patch } = input;
    // Đổi trạng thái chỉ đi qua quyền chuyển trạng thái (giống POST :id/transition), không đi chung quyền sửa.
    let transitionOwnOnly = false;
    if (patch.statusId)
      transitionOwnOnly = (await this.assertCanTransition(userId, workspaceId, projectId)).ownOnly;
    await assertProjectWritable(this.prisma, projectId);
    const rows = await this.prisma.issue.findMany({
      where: { id: { in: items.map((i) => i.id) }, workspaceId, projectId, deletedAt: null },
      include: issueInclude,
    });
    if (rows.length !== items.length) throw new NotFoundAppException('Công việc');
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (ownOnly || transitionOwnOnly) for (const r of rows) this.assertOwnsIssue(userId, r); // một việc của người khác → 403 cả lô, chưa ghi gì
    await this.assertMetaInWorkspace(workspaceId, {
      priorityId: patch.priorityId,
      // Chỉ kiểm khi có việc thật sự đổi sprint (lô đã ở đúng sprint đó thì thôi).
      sprintId: rows.some((r) => r.sprintId !== patch.sprintId) ? patch.sprintId : undefined,
      projectId,
    });
    // Chỉ kiểm khi có hàng thật sự đổi assignee (hàng đã giữ đúng assignee đó thì bỏ qua).
    if (patch.assigneeId !== undefined && rows.some((r) => r.assigneeId !== patch.assigneeId))
      await this.assertAssigneeInWorkspace(workspaceId, patch.assigneeId);

    // Chuyển trạng thái: kiểm tra workflow đúng như transition() trước khi ghi bất cứ thứ gì.
    let toDone = false;
    if (patch.statusId) {
      const workflowId = await this.workflowIdOf(projectId);
      for (const r of rows) {
        if (r.statusId !== patch.statusId)
          await this.assertTransitionAllowed(workflowId, r.statusId, patch.statusId);
      }
      toDone = (await this.statusCategory(patch.statusId)) === 'DONE';
    }
    // Giới hạn WIP của cột đích (nếu web gửi boardId); kiểm lại trong transaction sau khi khoá cột.
    const wip = patch.statusId
      ? await this.wipService.resolveWipColumn(input.boardId, projectId, patch.statusId)
      : null;

    const conflicts: BulkUpdateIssuesResult['conflicts'] = [];
    const changed: Array<{ before: IssueRow; after: IssueRow }> = [];
    const result: IssueRow[] = [];
    await this.prisma.$transaction(async (tx) => {
      if (wip) {
        // Chỉ tính việc thật sự SẼ vào cột: version còn khớp và chưa nằm trong cột đích.
        const incoming = items.filter((i) => {
          const b = byId.get(i.id)!;
          return b.version === i.version && !wip.statusIds.includes(b.statusId);
        }).length;
        if (incoming > 0)
          await this.wipService.enforceWip(tx, wip, {
            userId,
            workspaceId,
            projectId,
            incoming,
            force: input.force,
          });
      }
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
        if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId)
          data.assigneeId = patch.assigneeId;
        if (patch.priorityId !== undefined && patch.priorityId !== before.priorityId)
          data.priorityId = patch.priorityId;
        if (patch.sprintId !== undefined && patch.sprintId !== before.sprintId)
          data.sprintId = patch.sprintId;
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
    }, BULK_TX_OPTIONS);

    for (const { before, after } of changed) {
      const dto = this.toDto(after);
      const changedFields = changedFieldsOf(before, after);
      if (before.statusId !== after.statusId) {
        this.events.emit(DOMAIN_EVENTS.ISSUE_TRANSITIONED, {
          issue: dto,
          actorId: userId,
          fromStatusId: before.statusId,
        });
      }
      // Đổi thêm assignee/priority/sprint cùng lúc với status: vẫn phải có ISSUE_UPDATED
      // (thông báo "được giao việc", trigger automation). TRACKED_FIELDS không chứa status.
      if (changedFields.length > 0) {
        this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, {
          issue: dto,
          actorId: userId,
          changedFields,
        });
      }
    }
    return { updated: result.map((r) => this.toDto(r)), conflicts };
  }

  async transition(
    workspaceId: string,
    userId: string,
    id: string,
    input: TransitionIssueInput,
    opts?: AutomationEventMeta,
    ownOnly?: boolean,
  ): Promise<IssueDto> {
    const current = await this.requireIssue(workspaceId, id);
    if (ownOnly) this.assertOwnsIssue(userId, current);
    this.assertVersion(current.version, input.version);
    await this.assertMetaInWorkspace(workspaceId, { resolutionId: input.resolutionId });
    if (current.statusId === input.toStatusId) return this.toDto(current);

    // Validate transition theo workflow của project
    const workflowId = await this.workflowIdOf(current.projectId);
    await this.assertTransitionAllowed(workflowId, current.statusId, input.toStatusId);

    const isDone = (await this.statusCategory(input.toStatusId)) === 'DONE';
    const wip = await this.wipService.resolveWipColumn(
      input.boardId,
      current.projectId,
      input.toStatusId,
      current.statusId,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      if (wip)
        await this.wipService.enforceWip(tx, wip, {
          userId,
          workspaceId,
          projectId: current.projectId,
          incoming: 1,
          force: input.force,
        });
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
    this.events.emit(DOMAIN_EVENTS.ISSUE_TRANSITIONED, {
      issue: dto,
      actorId: userId,
      fromStatusId: current.statusId,
      ...withMeta(opts),
    });
    return dto;
  }

  async move(
    workspaceId: string,
    userId: string,
    id: string,
    input: MoveIssueInput,
    ownOnly?: boolean,
  ): Promise<IssueDto> {
    const current = await this.requireIssue(workspaceId, id);
    if (ownOnly) this.assertOwnsIssue(userId, current);
    this.assertVersion(current.version, input.version);
    const statusChanged = !!input.statusId && input.statusId !== current.statusId;
    const sprintChanged = this.sprintIfChanged(input.sprintId, current.sprintId) !== undefined;
    const wantsRank = !!input.afterId || !!input.beforeId;
    // `/move` chỉ đòi `issue:transition` nhưng còn nhận sprint + mốc rank: hai việc đó cần quyền riêng (như `/rank`).
    const useRankHint = await this.assertMoveCapabilities(workspaceId, userId, current, {
      sprintChanged,
      wantsRank,
      statusChanged,
    });
    await this.assertMetaInWorkspace(workspaceId, {
      sprintId: this.sprintIfChanged(input.sprintId, current.sprintId),
      projectId: current.projectId,
    });

    // Kéo sang cột khác là đổi trạng thái: đi đúng workflow như transition()/bulkUpdate(). Kiểm TRƯỚC resolveRank
    // để không rebalance rank rồi mới báo lỗi; kéo cùng cột/xếp lại thứ tự không đụng workflow.
    let toDone = false;
    if (statusChanged) {
      await this.assertTransitionAllowed(
        await this.workflowIdOf(current.projectId),
        current.statusId,
        input.statusId!,
      );
      toDone = (await this.statusCategory(input.statusId!)) === 'DONE';
    }

    // Không có mốc nào ⇒ giữ rank hiện tại (trước đây rankBetween(null, null) đặt thẻ vào GIỮA dự án).
    const hasNeighbor = wantsRank && useRankHint;
    const rank = hasNeighbor
      ? await this.rankService.resolveRank(current.projectId, this.prisma, null, id, async () => ({
          prev: input.afterId
            ? await this.rankService.rankOf(workspaceId, current.projectId, input.afterId)
            : null,
          next: input.beforeId
            ? await this.rankService.rankOf(workspaceId, current.projectId, input.beforeId)
            : null,
        }))
      : current.rank;

    // Chỉ kiểm WIP khi thật sự đổi sang trạng thái khác (kéo trong cùng cột/xếp lại thứ tự thì không chiếm thêm chỗ).
    const wip = statusChanged
      ? await this.wipService.resolveWipColumn(
          input.boardId,
          current.projectId,
          input.statusId!,
          current.statusId,
        )
      : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (wip)
        await this.wipService.enforceWip(tx, wip, {
          userId,
          workspaceId,
          projectId: current.projectId,
          incoming: 1,
          force: input.force,
        });
      const row = await this.updateWithVersion(tx, id, workspaceId, input.version, {
        rank,
        statusId: input.statusId ?? current.statusId,
        sprintId: input.sprintId !== undefined ? input.sprintId : current.sprintId,
        updatedById: userId,
        // Cùng quy ước bulkUpdate: sang DONE giữ resolutionId (move không nhận resolutionId), rời DONE xoá cả hai.
        ...(statusChanged
          ? { resolutionId: toDone ? undefined : null, resolvedAt: toDone ? new Date() : null }
          : {}),
      });
      // Kéo sang cột/trạng thái khác cũng là đổi trạng thái: ghi lịch sử để CFD/burndown không hụt.
      if (row.statusId !== current.statusId)
        await this.recordStatusChange(tx, userId, current, row);
      // Đổi sprint qua move cũng phải để lại lịch sử SPRINT (burndown/velocity dựa vào đó), như update()/bulkUpdate().
      // Ở move chỉ sprint có thể khác nên recordChanges chỉ ghi đúng dòng SPRINT.
      if (row.sprintId !== current.sprintId) await this.recordChanges(tx, userId, current, row);
      return row;
    });
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.ISSUE_MOVED, {
      issueId: id,
      projectId: updated.projectId,
      fromStatusId: current.statusId,
      toStatusId: updated.statusId,
      rank,
      sprintId: updated.sprintId,
      version: updated.version,
      actorId: userId,
    });
    // ISSUE_MOVED lo rank/board realtime; ISSUE_TRANSITIONED cho automation, SLA, thông báo, watcher, tích hợp.
    if (statusChanged)
      this.events.emit(DOMAIN_EVENTS.ISSUE_TRANSITIONED, {
        issue: dto,
        actorId: userId,
        fromStatusId: current.statusId,
      });
    // Đổi sprint cũng là cập nhật issue: automation/thông báo/tích hợp phải thấy (như PATCH).
    if (updated.sprintId !== current.sprintId)
      this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, {
        issue: dto,
        actorId: userId,
        changedFields: ['sprintId'],
      });
    return dto;
  }

  /** Soft-delete (vào Recycle Bin). */
  async softDelete(workspaceId: string, userId: string, id: string): Promise<{ success: true }> {
    const current = await this.requireIssue(workspaceId, id);
    // updateMany + deletedAt:null để hai lần xoá đồng thời chỉ một lần thắng (và chỉ phát sự kiện một lần).
    const { count } = await this.prisma.issue.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), updatedById: userId, version: { increment: 1 } },
    });
    if (count === 0) throw new NotFoundAppException('Công việc');
    this.events.emit(DOMAIN_EVENTS.ISSUE_DELETED, {
      issueId: id,
      projectId: current.projectId,
      actorId: userId,
    });
    return { success: true };
  }

  /**
   * Người BÁO/TẠO tự xoá việc của mình ngay sau khi tạo (nhầm, trùng) mà không cần `issue:delete`.
   * Server quyết hết điều kiện: đúng người, trong `RETRACT_WINDOW_MS` kể từ `createdAt`, chưa có việc con,
   * chưa có bình luận của người KHÁC. Xoá mềm → vào Thùng rác (quản trị dự án khôi phục được).
   */
  async retract(workspaceId: string, userId: string, id: string): Promise<{ success: true }> {
    const current = await this.requireIssue(workspaceId, id); // đã chặn dự án lưu trữ
    if (current.reporterId !== userId && current.createdById !== userId)
      throw new ForbiddenAppException(
        'Chỉ người báo cáo công việc này mới thu hồi được — hãy nhờ quản trị dự án xoá',
      );
    if (Date.now() - current.createdAt.getTime() > RETRACT_WINDOW_MS)
      throw new BusinessRuleException('Đã quá 10 phút kể từ lúc báo — hãy nhờ quản trị dự án xoá');
    const [children, others] = await Promise.all([
      // Việc con (parentId) hoặc việc gắn vào Epic này (epicId) đều chặn thu hồi.
      this.prisma.issue.count({
        where: { deletedAt: null, OR: [{ parentId: id }, { epicId: id }] },
      }),
      // Bình luận không rõ tác giả (authorId NULL: tài khoản đã xoá/bình luận hệ thống) coi như của người khác;
      // `authorId: { not }` một mình bị SQL bỏ qua NULL.
      this.prisma.comment.count({
        where: {
          issueId: id,
          deletedAt: null,
          OR: [{ authorId: null }, { authorId: { not: userId } }],
        },
      }),
    ]);
    if (children > 0)
      throw new BusinessRuleException('Công việc đã có việc con — hãy nhờ quản trị dự án xoá');
    if (others > 0)
      throw new BusinessRuleException('Đã có người bình luận — hãy nhờ quản trị dự án xoá');
    return this.softDelete(workspaceId, userId, id);
  }

  /** Khôi phục việc đã xoá mềm (Thùng rác). Dự án lưu trữ → chặn; hai lần đồng thời chỉ một lần thắng. */
  async restore(
    workspaceId: string,
    userId: string,
    projectId: string,
    issueId: string,
  ): Promise<IssueDto> {
    const where = { id: issueId, workspaceId, projectId, deletedAt: { not: null } };
    // allow-deleted: khôi phục cố ý đọc việc đã xoá mềm
    const current = await this.prisma.issue.findFirst({ where, include: issueWriteInclude });
    if (!current) throw new NotFoundAppException('Công việc');
    assertNotArchived(current.project.archivedAt);
    // Cha/Epic đã xoá mềm (hoặc không còn) → khôi phục thành việc KHÔNG cha/epic thay vì treo vào việc đã xoá.
    const refs = [current.parentId, current.epicId].filter((x): x is string => !!x);
    const alive = new Set(
      refs.length
        ? (
            await this.prisma.issue.findMany({
              where: { id: { in: refs }, workspaceId, deletedAt: null },
              select: { id: true },
            })
          ).map((r) => r.id)
        : [],
    );
    const orphaned: string[] = [];
    const detach: { parentId?: null; epicId?: null } = {};
    if (current.parentId && !alive.has(current.parentId)) {
      detach.parentId = null;
      orphaned.push('parentId');
    }
    if (current.epicId && !alive.has(current.epicId)) {
      detach.epicId = null;
      orphaned.push('epicId');
    }
    const { count } = await this.prisma.issue.updateMany({
      where,
      data: { deletedAt: null, updatedById: userId, version: { increment: 1 }, ...detach },
    });
    if (count === 0) throw new NotFoundAppException('Công việc');
    const row = await this.prisma.issue.findFirstOrThrow({
      where: { id: issueId, workspaceId, deletedAt: null },
      include: issueInclude,
    });
    const dto = this.toDto(row);
    this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, {
      issue: dto,
      actorId: userId,
      changedFields: ['deletedAt', ...orphaned],
    });
    return dto;
  }

  // ---------- helpers ----------
  /** Issue dùng cho thao tác GHI: dự án đã lưu trữ thì từ chối ngay. */
  private async requireIssue(workspaceId: string, id: string): Promise<IssueWriteRow> {
    const issue = await this.prisma.issue.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: issueWriteInclude,
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    assertNotArchived(issue.project.archivedAt);
    return issue;
  }

  /** Chặn vòng lặp cây: đi ngược từ parent mới lên gốc, không được gặp lại chính issue con. */
  private async assertNoParentCycle(
    workspaceId: string,
    childId: string,
    newParentId: string,
  ): Promise<void> {
    let cur: string | null = newParentId;
    let depth = 0;
    while (cur && depth < 200) {
      if (cur === childId) {
        throw new BusinessRuleException(
          'Không thể chọn việc con (hoặc việc cháu) làm việc cha vì sẽ tạo vòng lặp — hãy chọn một công việc ngoài nhánh này',
        );
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
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { defaultWorkflowId: true },
    });
    return project?.defaultWorkflowId ?? '';
  }

  /** Chỉ cho chuyển sang `toStatusId` nếu workflow có transition từ trạng thái hiện tại (hoặc từ "bất kỳ"). */
  private async assertTransitionAllowed(
    workflowId: string,
    fromStatusId: string,
    toStatusId: string,
  ): Promise<void> {
    const allowed = await this.prisma.workflowTransition.findFirst({
      where: { workflowId, toStatusId, OR: [{ fromStatusId }, { fromStatusId: null }] },
      select: { id: true },
    });
    if (!allowed) throw new InvalidTransitionException();
  }

  private async statusCategory(statusId: string) {
    return (
      await this.prisma.status.findUnique({ where: { id: statusId }, select: { category: true } })
    )?.category;
  }

  private async recordStatusChange(
    tx: Prisma.TransactionClient,
    userId: string,
    before: IssueRow,
    after: IssueRow,
  ) {
    await tx.issueHistory.create({
      data: {
        issueId: after.id,
        projectId: after.projectId,
        sprintId: after.sprintId,
        field: 'STATUS',
        oldValue: before.status.name,
        newValue: after.status.name,
        oldCategory: before.status.category,
        newCategory: after.status.category,
        actorId: userId,
        occurredAt: new Date(),
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
      const cur = await tx.issue.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { version: true },
      });
      if (!cur) throw new NotFoundAppException('Công việc');
      throw new VersionConflictException(
        'Người khác vừa sửa công việc này — hãy tải lại để xem bản mới nhất rồi thao tác lại',
        { version: cur.version },
      );
    }
    // allow-deleted: dòng vừa được updateMany (có deletedAt: null) trong cùng transaction — đọc lại chính nó
    return tx.issue.findFirstOrThrow({ where: { id }, include: issueInclude });
  }

  private assertVersion(currentVersion: number, inputVersion: number) {
    if (currentVersion !== inputVersion) {
      throw new VersionConflictException(
        'Người khác vừa sửa công việc này — hãy tải lại để xem bản mới nhất rồi thao tác lại',
        { version: currentVersion },
      );
    }
  }

  private async recordChanges(
    tx: Prisma.TransactionClient,
    userId: string,
    before: IssueRow,
    after: IssueRow,
  ) {
    const rows: Prisma.IssueHistoryCreateManyInput[] = [];
    const base = {
      issueId: after.id,
      projectId: after.projectId,
      sprintId: after.sprintId,
      actorId: userId,
      occurredAt: new Date(),
    };
    if (before.assigneeId !== after.assigneeId)
      rows.push({
        ...base,
        field: 'ASSIGNEE',
        oldValue: before.assigneeId,
        newValue: after.assigneeId,
      });
    if (before.priorityId !== after.priorityId)
      rows.push({
        ...base,
        field: 'PRIORITY',
        oldValue: before.priority?.name,
        newValue: after.priority?.name,
      });
    if (before.storyPoints !== after.storyPoints)
      rows.push({
        ...base,
        field: 'STORY_POINTS',
        oldValue: String(before.storyPoints ?? ''),
        newValue: String(after.storyPoints ?? ''),
        pointsDelta: (after.storyPoints ?? 0) - (before.storyPoints ?? 0),
      });
    if (before.sprintId !== after.sprintId)
      rows.push({ ...base, field: 'SPRINT', oldValue: before.sprintId, newValue: after.sprintId });
    if (rows.length) await tx.issueHistory.createMany({ data: rows });
  }

  private toDto(i: IssueRow): IssueDto {
    return {
      id: i.id,
      key: i.key,
      summary: i.summary,
      type: {
        id: i.type.id,
        name: i.type.name,
        key: i.type.key,
        iconUrl: i.type.iconUrl,
        color: i.type.color,
        hierarchyLevel: i.type.hierarchyLevel,
        isSubtask: i.type.isSubtask,
      },
      status: {
        id: i.status.id,
        workflowId: i.status.workflowId,
        name: i.status.name,
        category: i.status.category,
        color: i.status.color,
        order: i.status.order,
        isInitial: i.status.isInitial,
      },
      priority: i.priority
        ? {
            id: i.priority.id,
            name: i.priority.name,
            iconKey: i.priority.iconKey,
            color: i.priority.color,
            rank: i.priority.rank,
            isDefault: i.priority.isDefault,
          }
        : null,
      assignee: i.assignee ? toUserDto(i.assignee) : null,
      workspaceId: i.workspaceId,
      projectId: i.projectId,
      number: i.number,
      description: i.description,
      descriptionFormat: i.descriptionFormat,
      reporter: i.reporter ? toUserDto(i.reporter) : null,
      reporterId: i.reporterId,
      createdById: i.createdById,
      assigneeId: i.assigneeId,
      parentId: i.parentId,
      epicId: i.epicId,
      sprintId: i.sprintId,
      storyPoints: i.storyPoints,
      originalEstimate: i.originalEstimate,
      remainingEstimate: i.remainingEstimate,
      timeSpent: i.timeSpent,
      dueDate: iso(i.dueDate),
      startDate: iso(i.startDate),
      resolution: i.resolution
        ? {
            id: i.resolution.id,
            name: i.resolution.name,
            description: i.resolution.description,
            rank: i.resolution.rank,
          }
        : null,
      resolvedAt: iso(i.resolvedAt),
      severity: i.severity
        ? {
            id: i.severity.id,
            name: i.severity.name,
            description: i.severity.description,
            color: i.severity.color,
            rank: i.severity.rank,
            isDefault: i.severity.isDefault,
          }
        : null,
      triageState: i.triageState,
      triageSnoozeUntil: iso(i.triageSnoozeUntil),
      occurrenceCount: i.occurrenceCount,
      environment: (i.environment as IssueEnvironment | null) ?? null,
      rank: i.rank,
      version: i.version,
      labels: i.labels.map((l) => ({
        id: l.label.id,
        projectId: l.label.projectId,
        name: l.label.name,
        color: l.label.color,
      })),
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  }
}
